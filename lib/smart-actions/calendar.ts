import { record, textValue } from './safety';

export interface CalendarEvent {
    uid?: string; summary: string; description?: string; location?: string; url?: string;
    start?: string; end?: string; allDay: boolean; timeZone?: string; cancelled: boolean;
    recurring?: boolean;
    incomplete?: boolean;
}

function unescapeText(value: string): string {
    return value.replace(/\\[nN]/g, '\n').replace(/\\([,;\\])/g, '$1');
}

function dateValue(raw: string, timeZone?: string): string | undefined {
    if (/^\d{8}$/.test(raw)) {
        const date = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
        const parsed = new Date(`${date}T00:00:00Z`);
        return Number.isFinite(parsed.getTime()) && parsed.toISOString().startsWith(date) ? date : undefined;
    }
    const match = raw.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/);
    if (!match) return undefined;
    const [, y, mo, d, h, mi, s = '00', utc] = match;
    const wall = `${y}-${mo}-${d}T${h}:${mi}:${s}`;
    const target = Date.parse(`${wall}Z`);
    if (!Number.isFinite(target) || new Date(target).toISOString().slice(0, 19) !== wall) return undefined;
    if (utc) return new Date(target).toISOString();
    if (!timeZone) {
        const local = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
        return local.getFullYear() === Number(y) && local.getMonth() === Number(mo) - 1 && local.getDate() === Number(d)
            && local.getHours() === Number(h) && local.getMinutes() === Number(mi) ? local.toISOString() : undefined;
    }
    try {
        const formatter = new Intl.DateTimeFormat('en-CA', {
            timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
        });
        let candidate = target;
        for (let i = 0; i < 4; i++) {
            const parts = Object.fromEntries(formatter.formatToParts(candidate).map(part => [part.type, part.value]));
            const observed = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
            const difference = target - observed;
            if (!difference) return new Date(candidate).toISOString();
            candidate += difference;
        }
    } catch { /* Unknown TZID: show the invite, never invent a time. */ }
    return undefined;
}

export function parseCalendar(raw: unknown, fallbackTitle: string): CalendarEvent[] {
    if (typeof raw !== 'string' || raw.length > 256_000) return [];
    const lines = raw.replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
    let method = '';
    let fields: Map<string, { value: string; params: string }> | null = null;
    let nested = 0;
    const events: CalendarEvent[] = [];
    for (const line of lines) {
        if (line.toUpperCase().startsWith('METHOD:')) method = line.slice(7).toUpperCase();
        if (line.toUpperCase() === 'BEGIN:VEVENT') { fields = new Map(); nested = 0; continue; }
        if (!fields) continue;
        if (line.toUpperCase().startsWith('BEGIN:')) { nested++; continue; }
        if (nested) { if (line.toUpperCase().startsWith('END:')) nested--; continue; }
        if (line.toUpperCase() === 'END:VEVENT') {
            const get = (name: string) => fields?.get(name)?.value;
            const startField = fields.get('DTSTART');
            const timeZone = startField?.params.match(/(?:^|;)TZID=(?:"([^"]+)"|([^;]+))/i)?.slice(1).find(Boolean);
            const start = startField ? dateValue(startField.value, timeZone) : undefined;
            const endField = fields.get('DTEND');
            const endZone = endField?.params.match(/(?:^|;)TZID=(?:"([^"]+)"|([^;]+))/i)?.slice(1).find(Boolean) || timeZone;
            let end = endField ? dateValue(endField.value, endZone) : undefined;
            let incomplete = Boolean(endField && !end);
            const duration = get('DURATION');
            if (!endField && duration && start) {
                const match = duration.match(/^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
                const seconds = match ? Number(match[1] || 0) * 604800 + Number(match[2] || 0) * 86400 + Number(match[3] || 0) * 3600 + Number(match[4] || 0) * 60 + Number(match[5] || 0) : NaN;
                if (Number.isFinite(seconds) && seconds > 0 && seconds <= 366 * 86400 && !(timeZone && match && (match[1] || match[2]))) {
                    const result = new Date(Date.parse(start.length === 10 ? `${start}T00:00:00Z` : start) + seconds * 1000).toISOString();
                    end = start.length === 10 ? result.slice(0, 10) : result;
                } else incomplete = true;
            }
            events.push({
                uid: get('UID'), summary: unescapeText(get('SUMMARY') || fallbackTitle || 'Calendar event'),
                description: unescapeText(get('DESCRIPTION') || '').slice(0, 4000), location: unescapeText(get('LOCATION') || ''),
                url: get('URL'), start, end, allDay: Boolean(start && start.length === 10), timeZone,
                cancelled: method === 'CANCEL' || get('STATUS')?.toUpperCase() === 'CANCELLED',
                recurring: fields.has('RRULE') || fields.has('RECURRENCE-ID'),
                incomplete: incomplete || Boolean(start && end && (start.length !== end.length || Date.parse(end) <= Date.parse(start))),
            });
            fields = null;
            if (events.length === 10) break;
            continue;
        }
        const separator = line.indexOf(':');
        if (separator < 1) continue;
        const [name, ...parameters] = line.slice(0, separator).split(';');
        if (!fields.has(name.toUpperCase())) fields.set(name.toUpperCase(), { value: line.slice(separator + 1), params: parameters.join(';') });
    }
    return events;
}

export function structuredEvent(metadata: Record<string, unknown>, title: string): CalendarEvent | null {
    const start = textValue(metadata.startDate);
    // Require an explicit offset for structured timestamps. A date alone is all day.
    if (!start || !validIsoDate(start)) return null;
    const rawEnd = textValue(metadata.endDate);
    const end = rawEnd && validIsoDate(rawEnd) && (rawEnd.length === 10) === (start.length === 10) ? rawEnd : undefined;
    return { summary: textValue(metadata.name) || title, start, end, incomplete: Boolean(rawEnd && !end),
        allDay: start.length === 10, cancelled: String(metadata.eventStatus || '').endsWith('EventCancelled'),
        location: record(metadata.location) ? textValue(metadata.location.name) : textValue(metadata.location),
        description: textValue(metadata.description, 4000), url: textValue(metadata.url),
    };
}

export function validIsoDate(value: string): boolean {
    if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value) || !Number.isFinite(Date.parse(value))) return false;
    const calendarDate = new Date(`${value.slice(0, 10)}T00:00:00Z`);
    if (!Number.isFinite(calendarDate.getTime()) || calendarDate.toISOString().slice(0, 10) !== value.slice(0, 10)) return false;
    if (value.length > 10) {
        const clock = value.slice(11).match(/^(\d{2}):(\d{2})(?::(\d{2}))?/);
        if (!clock || Number(clock[1]) > 23 || Number(clock[2]) > 59 || Number(clock[3] || 0) > 59) return false;
    }
    return true;
}

export function calendarUrl(value: unknown): string | null {
    if (!record(value) || typeof value.start !== 'string' || value.cancelled || value.recurring || value.incomplete) return null;
    const start = new Date(value.allDay ? `${value.start}T00:00:00Z` : value.start);
    if (!Number.isFinite(start.getTime())) return null;
    let end = typeof value.end === 'string' ? new Date(value.allDay ? `${value.end}T00:00:00Z` : value.end) : new Date(start);
    if (!value.end && value.allDay) end = new Date(start.getTime() + 86400000);
    if (!Number.isFinite(end.getTime()) || end < start) return null;
    const format = (date: Date) => value.allDay ? date.toISOString().slice(0, 10).replaceAll('-', '') : date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
    const url = new URL('https://calendar.google.com/calendar/render');
    url.searchParams.set('action', 'TEMPLATE'); url.searchParams.set('text', textValue(value.summary) || 'Calendar event');
    url.searchParams.set('dates', `${format(start)}/${format(end)}`);
    if (typeof value.description === 'string') url.searchParams.set('details', value.description.slice(0, 4000));
    if (typeof value.location === 'string') url.searchParams.set('location', value.location.slice(0, 500));
    return url.href;
}
