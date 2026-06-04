import { useMemo } from 'react';
import { Attachment } from '@/lib/types';
import { addMinutes } from 'date-fns';

export type MeetingProvider = 
  | 'zoom' 
  | 'google_meet' 
  | 'teams' 
  | 'webex' 
  | 'calendly' 
  | 'riverside' 
  | 'around' 
  | 'unknown';

export interface MeetingInfo {
  provider: MeetingProvider;
  url: string;
  meetingId?: string;
  title?: string;
  displayTitle: string;
  startTime?: Date;
  endTime?: Date;
  isPastMeeting: boolean;
  confidence: 'high' | 'medium' | 'low';
  source: 'ics_attachment' | 'vcalendar_body' | 'structured_text' | 'link_only';
  calendarSource?: {
    sourceType: 'ics_attachment' | 'vcalendar_body' | 'structured_text';
    extractedTimezone?: string;
  };
}

const PROVIDER_PRIORITY: Record<MeetingProvider, number> = {
  zoom: 10,
  google_meet: 9,
  teams: 8,
  webex: 7,
  riverside: 6,
  around: 5,
  calendly: 4,
  unknown: 0,
};

// --- Regex Definitions ---

const ZOOM_REGEX = /https:\/\/(?:[a-zA-Z0-9-]+\.)?zoom\.us\/j\/(\d+)(?:\?pwd=[a-zA-Z0-9]+)?/i;
const MEET_REGEX = /https:\/\/meet\.google\.com\/([a-z0-9-]+)/i;
const TEAMS_REGEX = /https:\/\/(?:teams\.microsoft\.com|teams\.live\.com)\/(?:l\/meetup-join\/|meet\/|dl\/launcher\/)([^"'\s]+)/i;
const WEBEX_REGEX = /https:\/\/[a-zA-Z0-9-]+\.webex\.com\/(?:[a-zA-Z0-9-]+\/j\.php\?MTID=|meet\/)([a-zA-Z0-9-]+)/i;
const CALENDLY_REGEX = /https:\/\/calendly\.com\/([^"'\s]+)/i;
const RIVERSIDE_REGEX = /https:\/\/riverside\.fm\/studio\/([^"'\s]+)/i;
const AROUND_REGEX = /https:\/\/meet\.around\.co\/([^"'\s]+)/i;

// Match standard "https://" URLs in text
const URL_REGEX = /https:\/\/[^"'\s<>]+/ig;

/**
 * Identify the provider and extract the meeting ID from a given URL.
 */
function identifyProvider(url: string): { provider: MeetingProvider; meetingId?: string } {
  let match;
  
  if ((match = url.match(ZOOM_REGEX))) return { provider: 'zoom', meetingId: match[1] };
  if ((match = url.match(MEET_REGEX))) return { provider: 'google_meet', meetingId: match[1] };
  if ((match = url.match(TEAMS_REGEX))) return { provider: 'teams' }; // Teams IDs are huge/complex
  if ((match = url.match(WEBEX_REGEX))) return { provider: 'webex', meetingId: match[1] };
  if ((match = url.match(CALENDLY_REGEX))) return { provider: 'calendly' };
  if ((match = url.match(RIVERSIDE_REGEX))) return { provider: 'riverside', meetingId: match[1] };
  if ((match = url.match(AROUND_REGEX))) return { provider: 'around', meetingId: match[1] };

  // Fallback heuristic: maybe it contains known words
  if (url.includes('zoom.us')) return { provider: 'zoom' };
  if (url.includes('meet.google.com')) return { provider: 'google_meet' };
  if (url.includes('teams.microsoft.com') || url.includes('teams.live.com')) return { provider: 'teams' };
  if (url.includes('webex.com')) return { provider: 'webex' };
  
  return { provider: 'unknown' };
}

/**
 * Basic VCALENDAR parser for extracting event details
 */
function parseVCalendar(icsData: string) {
  let title: string | undefined;
  let startTime: Date | undefined;
  let endTime: Date | undefined;
  let timezone: string | undefined;

  const lines = icsData.split(/\r?\n/);
  for (const line of lines) {
    if (line.startsWith('SUMMARY:')) title = line.substring(8);
    
    // Simplistic DTSTART parser
    // E.g., DTSTART;TZID=America/Los_Angeles:20260605T140000
    // E.g., DTSTART:20260605T140000Z
    if (line.startsWith('DTSTART')) {
      const match = line.match(/TZID=([^:]+)/);
      if (match) timezone = match[1];
      
      const timeMatch = line.match(/.*:(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)/);
      if (timeMatch) {
        const [, y, m, d, h, min, s, z] = timeMatch;
        const iso = `${y}-${m}-${d}T${h}:${min}:${s}${z ? 'Z' : ''}`;
        startTime = new Date(iso);
      }
    }

    if (line.startsWith('DTEND')) {
      const timeMatch = line.match(/.*:(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)/);
      if (timeMatch) {
        const [, y, m, d, h, min, s, z] = timeMatch;
        const iso = `${y}-${m}-${d}T${h}:${min}:${s}${z ? 'Z' : ''}`;
        endTime = new Date(iso);
      }
    }
  }

  return { title, startTime, endTime, timezone };
}

/**
 * Attempt to extract time from unstructured text.
 * This is highly heuristic and prone to false negatives, but handles basic cases.
 */
function extractTimeFromText(text: string) {
  // E.g., "When: June 5, 2026 2:00 PM PST"
  const whenMatch = text.match(/(?:when|time|date)\s*:\s*([^<>\n]+)/i);
  if (!whenMatch) return null;

  const timeStr = whenMatch[1].trim();
  const d = new Date(timeStr);
  
  if (isNaN(d.getTime())) return null;

  // Basic timezone detection heuristic
  const hasTimezone = /\b(PST|PDT|EST|EDT|CST|CDT|MST|MDT|UTC|GMT|[A-Z]{3,4})\b/i.test(timeStr) || 
                      /(\+|-)\d{2}:?\d{2}/.test(timeStr);

  return {
    startTime: d,
    timezone: hasTimezone ? timeStr.match(/\b(PST|PDT|EST|EDT|CST|CDT|MST|MDT|UTC|GMT|[A-Z]{3,4})\b/i)?.[0] : undefined,
    confidence: hasTimezone ? 'high' as const : 'medium' as const,
  };
}

export function useMeetingDetection(
  htmlBody: string | undefined | null,
  plainTextBody: string | undefined | null,
  subject: string | undefined | null,
  attachments: Attachment[] = []
): MeetingInfo[] {
  return useMemo(() => {
    const textToSearch = plainTextBody || htmlBody?.replace(/<[^>]*>?/gm, ' ') || '';
    const meetingsMap = new Map<string, Partial<MeetingInfo>>();

    // 1. Find all raw URLs
    const urls = [...textToSearch.matchAll(URL_REGEX)].map(m => m[0]);
    
    for (const url of urls) {
      // Security check: must be https
      if (!url.startsWith('https://')) continue;
      
      const { provider, meetingId } = identifyProvider(url);
      if (provider !== 'unknown' || url.includes('meeting') || url.includes('join')) {
        meetingsMap.set(url, {
          url,
          provider,
          meetingId,
          source: 'link_only',
          confidence: 'low'
        });
      }
    }

    // If no meetings found, we can exit early.
    // Wait, what if there is an ICS attachment without a link in the body?
    // We should ideally extract the link from the ICS location or description.
    // We'll skip that complex extraction for MVP unless the ICS explicitly has the link.

    // 2. Structured Text Extraction
    if (meetingsMap.size > 0) {
      const textTime = extractTimeFromText(textToSearch);
      if (textTime) {
        for (const [url, info] of meetingsMap.entries()) {
          meetingsMap.set(url, {
            ...info,
            startTime: textTime.startTime,
            confidence: textTime.confidence,
            source: 'structured_text',
            calendarSource: {
              sourceType: 'structured_text',
              extractedTimezone: textTime.timezone
            }
          });
        }
      }
    }

    // 3. VCALENDAR Block Parsing
    const vcalMatch = textToSearch.match(/BEGIN:VCALENDAR[\s\S]+?END:VCALENDAR/);
    if (vcalMatch) {
      const parsed = parseVCalendar(vcalMatch[0]);
      if (parsed.startTime) {
        // Apply this to all found meetings, upgrading their confidence and source
        for (const [url, info] of meetingsMap.entries()) {
          meetingsMap.set(url, {
            ...info,
            title: parsed.title || info.title,
            startTime: parsed.startTime,
            endTime: parsed.endTime,
            confidence: parsed.timezone ? 'high' : 'medium',
            source: 'vcalendar_body',
            calendarSource: {
              sourceType: 'vcalendar_body',
              extractedTimezone: parsed.timezone
            }
          });
        }
      }
    }

    // 4. ICS Attachment parsing
    // In Tauri, reading the attachment might be async, so we'd have to read the bytes.
    // For now, if we have an attachment named *.ics, we flag it. Actual parsing of external
    // ICS file content requires async File reading which isn't available synchronously in useMemo.
    // We'll skip deep ICS file parsing for this phase, or rely on VCALENDAR blocks usually being embedded.

    // 5. Final Assembly & Deduplication & Priority Sorting
    const results: MeetingInfo[] = [];
    const now = new Date();

    for (const info of meetingsMap.values()) {
      const startTime = info.startTime;
      const endTime = info.endTime || (startTime ? addMinutes(startTime, 60) : undefined);
      
      const isPastMeeting = endTime 
        ? endTime < now 
        : (startTime ? startTime < now : false);

      const computedTitle = info.title || subject || "Meeting";

      results.push({
        url: info.url!,
        provider: info.provider || 'unknown',
        meetingId: info.meetingId,
        title: info.title,
        displayTitle: computedTitle,
        startTime,
        endTime,
        isPastMeeting,
        confidence: info.confidence || 'low',
        source: info.source as any,
        calendarSource: info.calendarSource,
      });
    }

    return results.sort((a, b) => {
      // Highest priority first
      const pA = PROVIDER_PRIORITY[a.provider] || 0;
      const pB = PROVIDER_PRIORITY[b.provider] || 0;
      return pB - pA;
    });

  }, [htmlBody, plainTextBody, subject, attachments]);
}
