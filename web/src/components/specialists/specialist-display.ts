import type { Schemas } from "@/lib/api/client";
import { formatDate, formatTime, otherPartyHint } from "@/lib/format";
import type { Language, MessageKey } from "@/lib/i18n/messages";
import { peoplePath } from "@/lib/limit";

export const meetingsPath = "/app/meetings";

export function specialistPath(id: string): string {
  return peoplePath + "/specialists/" + encodeURIComponent(id);
}

export function attendedMeetingPath(id: string): string {
  return meetingsPath + "/attended/" + encodeURIComponent(id);
}

export function bookingDateTime(startsAt: string, timeZone: string, language: Language): string {
  return (
    formatDate(startsAt, timeZone, language) + " · " + formatTime(startsAt, timeZone, language)
  );
}

export function specialistTimeHint(
  meeting: Schemas["AttendedMeeting"],
  timeZone: string,
  language: Language,
): string | null {
  // spec:impl attended-meetings#render-attended-meeting-date-time
  return otherPartyHint(
    meeting.starts_at,
    timeZone,
    meeting.specialist.time_zone,
    "c.specialist_time",
    language,
  );
}

export function attendedStatus(meeting: Schemas["AttendedMeeting"], now: Date): MessageKey | null {
  // spec:impl attended-meetings#show-feed-row-past-attended
  if (Date.parse(meeting.starts_at) > now.getTime()) return null;
  if (meeting.status === "completed") return "c.status_done";
  if (meeting.status === "not_taken_place") {
    return meeting.charged ? "c.status_missed_charged" : "c.status_missed";
  }
  return null;
}
