import { DetectorContext, SmartAction, SmartActionKind, SmartActionPriority, SmartActionCommand, TrustLevel, DetectorSource, EntityType, SmartActionButton } from '../types';
import type { Detector } from '../engine';
import { calendarUrl, CalendarEvent, parseCalendar, structuredEvent } from '../calendar';
import { meetingUrl, textValue } from '../safety';

export const MeetingDetector: Detector = {
    id: 'meeting',
    detect: (ctx: DetectorContext): SmartAction[] => {
        const urls = [...new Set(ctx.extractedData.entities.filter(entity => entity.entityType === EntityType.Link)
            .map(entity => meetingUrl(entity.value)?.href).filter((url): url is string => Boolean(url)))];
        const events: CalendarEvent[] = [];
        for (const entity of ctx.extractedData.entities) {
            if (entity.entityType === EntityType.CalendarEvent) events.push(...parseCalendar(entity.metadata.vcalendar, ctx.subject));
            if (entity.entityType === EntityType.SchemaOrgObject && String(entity.metadata['@type']).match(/(?:^|\/)Event$/)) {
                const event = structuredEvent(entity.metadata, ctx.subject); if (event) events.push(event);
            }
        }
        const unique = new Map<string, CalendarEvent>();
        for (const event of events) {
            // Many invitations contain both JSON-LD and an ICS representation.
            // Prefer the ICS identity instead of showing the same event twice.
            if (!event.uid && events.some(other => other.uid && other.start === event.start
                && other.summary.trim().toLowerCase() === event.summary.trim().toLowerCase())) continue;
            unique.set(event.uid || `${event.summary}:${event.start}`, event);
        }
        const calendarEvents = [...unique.values()];
        if (!calendarEvents.length) return urls.slice(0, 2).map(url => ({
            id: `meeting:${url}`, kind: SmartActionKind.MEETING, priority: SmartActionPriority.High,
            trustLevel: TrustLevel.Unverified, detectorSource: DetectorSource.RuleBased,
            title: 'Meeting link', subtitle: new URL(url).hostname, confidence: 0.9, timestamp: ctx.receivedAt,
            actions: [{ label: 'Join meeting', command: SmartActionCommand.JoinMeeting, data: { url }, primary: true }],
        }));
        return calendarEvents.slice(0, 3).map((event): SmartAction => {
            const direct = meetingUrl(event.url)?.href;
            const embedded = `${event.location || ''} ${event.description || ''}`.match(/https:\/\/[^\s<>"']+/g) || [];
            const embeddedUrls = [...new Set(embedded.map(raw => meetingUrl(raw.replace(/[.,;)]+$/, ''))?.href).filter(Boolean))];
            const join = direct || (embeddedUrls.length === 1 ? embeddedUrls[0] : undefined)
                || (calendarEvents.length === 1 && urls.length === 1 ? urls[0] : undefined);
            const past = !event.recurring && event.end ? Date.parse(event.allDay ? `${event.end}T00:00:00` : event.end) < Date.now() : false;
            const actions: SmartActionButton[] = [];
            if (join && !event.cancelled && !past) actions.push({ label: 'Join meeting', command: SmartActionCommand.JoinMeeting, data: { url: join }, primary: true });
            if (calendarUrl(event)) actions.push({ label: 'Add to calendar', command: SmartActionCommand.AddToCalendar, data: { event } });
            return {
                id: `event:${event.uid || event.summary}:${event.start || ''}`, kind: SmartActionKind.MEETING,
                priority: event.cancelled || past ? SmartActionPriority.Low : SmartActionPriority.High,
                trustLevel: TrustLevel.Unverified, detectorSource: DetectorSource.RuleBased,
                title: textValue(event.summary) || 'Calendar event',
                subtitle: event.cancelled ? 'Cancelled event' : event.recurring ? 'Recurring invitation. See the original invite for the series.'
                    : !event.start ? 'See the original invitation for the time.' : past ? 'Past event' : 'Calendar invitation',
                metadata: { event }, confidence: 0.95, timestamp: ctx.receivedAt, actions,
            };
        });
    },
};
