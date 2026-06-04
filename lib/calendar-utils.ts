import { format, addMinutes } from "date-fns";

export interface CalendarEventDetails {
  title: string;
  description: string;
  location: string;
  startTime: Date;
  endTime?: Date;
}

/**
 * Format a Date object to YYYYMMDDTHHMMSSZ
 */
const formatIcsDate = (date: Date): string => {
  return date.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
};

/**
 * Format a Date object to YYYYMMDDTHHMMSS
 */
const formatGoogleDate = (date: Date): string => {
  return date.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
};

/**
 * Ensures we have an end time (defaults to start time + 60 mins)
 */
const getEndTime = (details: CalendarEventDetails): Date => {
  return details.endTime || addMinutes(details.startTime, 60);
};

export const generateGoogleCalendarUrl = (details: CalendarEventDetails): string => {
  const end = getEndTime(details);
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: details.title,
    dates: `${formatGoogleDate(details.startTime)}/${formatGoogleDate(end)}`,
    details: details.description,
    location: details.location,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
};

export const generateOutlookCalendarUrl = (details: CalendarEventDetails): string => {
  const end = getEndTime(details);
  // Outlook Web requires specific formatting
  const params = new URLSearchParams({
    path: "/calendar/action/compose",
    rru: "addevent",
    subject: details.title,
    startdt: details.startTime.toISOString(),
    enddt: end.toISOString(),
    body: details.description,
    location: details.location,
  });
  return `https://outlook.live.com/calendar/0/deeplink/compose?${params.toString()}`;
};

export const generateICS = (details: CalendarEventDetails): string => {
  const end = getEndTime(details);
  const now = formatIcsDate(new Date());

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//OrionMail//Meeting Extension//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    `DTSTAMP:${now}`,
    `DTSTART:${formatIcsDate(details.startTime)}`,
    `DTEND:${formatIcsDate(end)}`,
    `SUMMARY:${details.title.replace(/[,;\n]/g, "\\$&")}`,
    `DESCRIPTION:${details.description.replace(/\n/g, "\\n").replace(/[,;]/g, "\\$&")}`,
    `LOCATION:${details.location.replace(/[,;\n]/g, "\\$&")}`,
    `UID:${now}-${Math.random().toString(36).substring(2)}@orionmail.app`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
};

export const downloadICS = (details: CalendarEventDetails, filename = "invite.ics"): void => {
  if (typeof window === "undefined") return;
  
  const icsString = generateICS(details);
  const blob = new Blob([icsString], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  
  // Cleanup
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

export const copyToClipboard = async (text: string): Promise<boolean> => {
  if (typeof navigator !== "undefined" && navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (err) {
      console.error("Failed to copy text: ", err);
      return false;
    }
  }
  return false;
};
