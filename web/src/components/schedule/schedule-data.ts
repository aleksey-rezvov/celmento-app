import { apiClient, type Schemas } from "@/lib/api/client";
import type { operations } from "@/lib/api/schema";
import { getSessionToken } from "@/lib/session";
import { zonedClock } from "@/lib/zoned-date";

export type MeetingRange = operations["listMeetings"]["parameters"]["query"];

export async function listScheduledMeetings(
  range: MeetingRange,
  signal: AbortSignal,
): Promise<Schemas["MeetingList"]> {
  const token = getSessionToken();
  if (!token) throw new Error("No active schedule session.");

  const { data } = await apiClient(token).GET("/meetings", {
    params: { query: range },
    signal,
    cache: "no-store",
  });
  if (!data || getSessionToken() !== token) throw new Error("The schedule could not be loaded.");
  return data;
}

export function endOfMeeting(
  meeting: Pick<Schemas["Meeting"], "starts_at" | "duration_minutes">,
): Date {
  return new Date(Date.parse(meeting.starts_at) + meeting.duration_minutes * 60_000);
}

export function minuteOfDay(instant: Date | string, timeZone: string): number {
  const clock = zonedClock(instant, timeZone);
  return Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3));
}

export function compareMeetingStarts(
  first: Schemas["Meeting"],
  second: Schemas["Meeting"],
): number {
  return Date.parse(first.starts_at) - Date.parse(second.starts_at);
}
