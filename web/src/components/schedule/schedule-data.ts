import { apiClient, type Schemas } from "@/lib/api/client";
import type { operations } from "@/lib/api/schema";
import { listAccountNotices } from "@/lib/notices";
import { zonedClock } from "@/lib/zoned-date";

export type MeetingRange = operations["listMeetings"]["parameters"]["query"];
export type ScheduleItem =
  | { kind: "own"; meeting: Schemas["Meeting"] }
  | { kind: "attended"; meeting: Schemas["AttendedMeeting"] };

interface ScheduleSnapshot {
  schedule: Schemas["MeetingList"];
  notices: Schemas["Notice"][] | null;
}

export type OnScheduleLoaded = (snapshot: ScheduleSnapshot | null) => void;

export class ScheduleAccessLost extends Error {}

const noticeDeadlineMs = 500;

async function readTimelyNotices(
  token: string,
  signal: AbortSignal,
): Promise<Schemas["Notice"][] | null> {
  const controller = new AbortController();
  const noticeSignal = AbortSignal.any([signal, controller.signal]);
  let deadline: number | undefined;
  const timeout = new Promise<null>((resolve) => {
    deadline = window.setTimeout(() => {
      controller.abort();
      resolve(null);
    }, noticeDeadlineMs);
  });
  try {
    return await Promise.race([listAccountNotices(token, noticeSignal).catch(() => null), timeout]);
  } finally {
    if (deadline !== undefined) window.clearTimeout(deadline);
  }
}

export async function listScheduledMeetings(
  range: MeetingRange,
  currentSessionToken: () => string | null,
  signal: AbortSignal,
  includeNotices = true,
): Promise<ScheduleSnapshot> {
  const token = currentSessionToken();
  if (!token) throw new ScheduleAccessLost("No active schedule session.");

  // spec:impl client-meeting-notifications#keep-attendee-schedule-consistent-bar
  const notices = includeNotices ? await readTimelyNotices(token, signal) : null;
  signal.throwIfAborted();
  if (currentSessionToken() !== token) throw new ScheduleAccessLost("The session has changed.");

  const { data, response } = await apiClient(token).GET("/meetings", {
    params: { query: range },
    signal,
    cache: "no-store",
  });
  if (currentSessionToken() !== token || response.status === 401 || response.status === 403)
    throw new ScheduleAccessLost("Schedule access has ended.");
  if (!data) throw new Error("The schedule could not be loaded.");

  return { schedule: data, notices };
}

export function scheduleItems(list: Schemas["MeetingList"], leader: boolean): ScheduleItem[] {
  // spec:impl attended-meetings#show-attended-meetings-account-without-activation
  const own = leader ? list.items.map((meeting) => ({ kind: "own", meeting }) as const) : [];
  return [...own, ...list.attended.map((meeting) => ({ kind: "attended", meeting }) as const)];
}

export function scheduleItemKey(item: ScheduleItem): string {
  return item.kind + ":" + item.meeting.id;
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
  first: Pick<Schemas["Meeting"], "starts_at">,
  second: Pick<Schemas["Meeting"], "starts_at">,
): number {
  return Date.parse(first.starts_at) - Date.parse(second.starts_at);
}
