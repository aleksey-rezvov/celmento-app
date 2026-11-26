"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from "react";
import { useAccount } from "@/lib/account";
import type { Schemas } from "@/lib/api/client";
import { useTranslation, type MessageKey } from "@/lib/i18n";
import { firstCivilDayOfWeek, shiftCivilDay, zonedDay } from "@/lib/zoned-date";
import { AttendeeEmpty } from "./AttendeeEmpty";
import { FeedDayRow } from "./FeedDayRow";
import { WeekSeparator } from "./WeekSeparator";
import {
  compareMeetingStarts,
  listScheduledMeetings,
  ScheduleAccessLost,
  ScheduleOffline,
  scheduleItemKey,
  scheduleItems,
  type MeetingRange,
  type OnScheduleLoaded,
  type ScheduleItem,
} from "./schedule-data";
import { useScheduleRevalidation } from "./useScheduleRevalidation";

type Direction = "earlier" | "later";

interface Request {
  sequence: number;
  range: MeetingRange;
  direction: Direction | null;
}

interface FeedResult extends Pick<
  Schemas["MeetingList"],
  "next_outcome_in_seconds" | "attended_total" | "specialists_count"
> {
  sequence: number;
  range: MeetingRange;
  meetings: ScheduleItem[];
}

interface FeedViewProps {
  initialDay: string;
  today: string;
  now: Date;
  onVisibleDay: (day: string) => void;
  onPickDay: (day: string) => void;
  onOpen: (id: string) => void;
  onOpenAttended: (id: string) => void;
  onScheduleLoaded: OnScheduleLoaded;
}

function visibleRow(viewport: HTMLDivElement): HTMLElement | undefined {
  const top = viewport.getBoundingClientRect().top;
  return [...viewport.querySelectorAll<HTMLElement>("[data-feed-day]")].find(
    (row) => row.getBoundingClientRect().bottom > top,
  );
}

export function FeedView({
  initialDay,
  today,
  now,
  onVisibleDay,
  onPickDay,
  onOpen,
  onOpenAttended,
  onScheduleLoaded,
}: FeedViewProps): ReactElement {
  const { account, currentSessionToken } = useAccount();
  const t = useTranslation();
  const leader = account.activated;
  const viewport = useRef<HTMLDivElement>(null);
  const positioned = useRef(false);
  const lastScrollTop = useRef(0);
  const previousPosition = useRef<{ day: string; top: number } | null>(null);
  const [request, setRequest] = useState<Request>(() => ({
    sequence: 0,
    direction: null,
    range: {
      from: shiftCivilDay(initialDay, -14),
      to: shiftCivilDay(initialDay, 14),
    },
  }));
  const [window, setWindow] = useState<FeedResult | null>(null);
  const [failed, setFailed] = useState<{
    sequence: number;
    message: MessageKey;
  } | null>(null);
  const error = failed?.sequence === request.sequence ? failed.message : null;
  const loading = window?.sequence !== request.sequence && !error;
  const refresh = useCallback((): void => {
    if (loading) return;
    setRequest((value) => ({
      sequence: value.sequence + 1,
      direction: null,
      range: window?.range ?? value.range,
    }));
  }, [loading, window]);
  useScheduleRevalidation(window, refresh);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    async function load(): Promise<void> {
      try {
        const snapshot = await listScheduledMeetings(
          request.range,
          account.time_zone,
          currentSessionToken,
          signal,
          request.direction === null,
        );
        if (signal.aborted) return;
        const data = snapshot.schedule;
        const meetings = scheduleItems(data, leader);
        const metadata = {
          next_outcome_in_seconds: data.next_outcome_in_seconds,
          attended_total: data.attended_total,
          specialists_count: data.specialists_count,
        };
        const earlier = request.direction === "earlier";
        if (request.direction !== "later" && viewport.current) {
          const row = visibleRow(viewport.current);
          if (row?.dataset.feedDay)
            previousPosition.current = {
              day: row.dataset.feedDay,
              top: row.getBoundingClientRect().top,
            };
        }
        setWindow((existing) => {
          if (!existing || request.direction === null)
            return {
              sequence: request.sequence,
              range: request.range,
              meetings,
              ...metadata,
            };
          const loadedKeys = new Set(meetings.map(scheduleItemKey));
          const retained = existing.meetings.filter(
            (item) => !loadedKeys.has(scheduleItemKey(item)),
          );
          return {
            sequence: request.sequence,
            ...metadata,
            range: {
              from: earlier ? request.range.from : existing.range.from,
              to: earlier ? existing.range.to : request.range.to,
            },
            meetings: [...retained, ...meetings],
          };
        });
        onScheduleLoaded(snapshot);
      } catch (error) {
        if (signal.aborted) return;
        if (error instanceof ScheduleAccessLost) {
          setWindow(null);
          onScheduleLoaded(null);
        }
        setFailed({
          sequence: request.sequence,
          message:
            error instanceof ScheduleOffline
              ? "extra.meeting_offline"
              : "extra.auth_request_failed",
        });
      }
    }
    void load();
    return () => controller.abort();
  }, [account.time_zone, currentSessionToken, leader, onScheduleLoaded, request]);

  const days = useMemo(() => {
    const result = new Map<string, ScheduleItem[]>();
    if (!window) return result;

    // spec:impl schedule-feed-view#hide-day-without-meetings-feed
    for (const item of window.meetings.toSorted((a, b) =>
      compareMeetingStarts(a.meeting, b.meeting),
    )) {
      const day = zonedDay(item.meeting.starts_at, account.time_zone);
      const existing = result.get(day);
      if (existing) existing.push(item);
      else result.set(day, [item]);
    }
    if (today >= window.range.from && today <= window.range.to && !result.has(today))
      result.set(today, []);
    return result;
  }, [account.time_zone, today, window]);

  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element || !window) {
      positioned.current = false;
      return;
    }

    if (!positioned.current) {
      // spec:impl schedule-feed-view#open-feed-positioned-today-earlier
      const marker = element.querySelector(
        `[data-feed-day="${initialDay}"], [data-feed-anchor="${initialDay}"]`,
      );
      if (marker)
        element.scrollTop +=
          marker.getBoundingClientRect().top - element.getBoundingClientRect().top;
      positioned.current = true;
    } else if (previousPosition.current) {
      const position = previousPosition.current;
      const marker = element.querySelector(`[data-feed-day="${position.day}"]`);
      if (marker) element.scrollTop += marker.getBoundingClientRect().top - position.top;
    }
    previousPosition.current = null;
    lastScrollTop.current = element.scrollTop;
  }, [initialDay, window]);

  function extend(direction: Direction): void {
    if (loading || !window) return;
    const before = shiftCivilDay(window.range.from, -1);
    const after = shiftCivilDay(window.range.to, 1);
    const range =
      direction === "earlier"
        ? { from: shiftCivilDay(before, -28), to: before }
        : { from: after, to: shiftCivilDay(after, 28) };
    setRequest((value) => ({ sequence: value.sequence + 1, direction, range }));
  }

  const meetingDays = [...days.keys()].sort();
  const ordered = days.has(initialDay) ? meetingDays : [...meetingDays, initialDay].sort();
  const weekStarts = new Set(
    meetingDays.filter((day, index) => {
      const previous = meetingDays[index - 1];
      return previous === undefined || firstCivilDayOfWeek(day) !== firstCivilDayOfWeek(previous);
    }),
  );

  if (!leader && window?.attended_total === 0)
    return <AttendeeEmpty specialistsCount={window.specialists_count} />;

  // spec:impl schedule-feed-view#show-screen-3-2-continuous-feed
  return (
    <div
      className="schedule-scroll schedule-feed-scroll"
      ref={viewport}
      role="region"
      aria-label={t("meetings.view_schedule")}
      aria-busy={loading}
      tabIndex={0}
      onScroll={(event) => {
        const element = event.currentTarget;
        const current = element.scrollTop;
        const previous = lastScrollTop.current;
        lastScrollTop.current = current;
        if (!positioned.current || current === previous) return;

        const visible = visibleRow(element);
        if (visible?.dataset.feedDay) onVisibleDay(visible.dataset.feedDay);
        // spec:impl schedule-feed-view#load-earlier-days-person-scrolls
        if (current < previous && current < 120) extend("earlier");
        if (current > previous && element.scrollHeight - current - element.clientHeight < 120)
          extend("later");
      }}
    >
      {window && (
        <button
          type="button"
          className="schedule-edge"
          disabled={loading}
          onClick={() => extend("earlier")}
        >
          {t("extra.schedule_earlier")}
        </button>
      )}
      {ordered.map((day) => {
        const meetings = days.get(day);
        if (!meetings) return <div key={day} data-feed-anchor={day} aria-hidden="true" />;

        return (
          <Fragment key={day}>
            {/* spec:impl schedule-feed-view#insert-separator-before-first-day */}
            {weekStarts.has(day) && <WeekSeparator monday={firstCivilDayOfWeek(day)} />}
            <FeedDayRow
              day={day}
              today={day === today}
              meetings={meetings}
              now={now}
              timeZone={account.time_zone}
              onPickDay={onPickDay}
              onOpen={onOpen}
              onOpenAttended={onOpenAttended}
            />
          </Fragment>
        );
      })}
      {error && (
        <div role="alert" className="schedule-error">
          <p>{t(error)}</p>
          <button
            className="shell-secondary"
            type="button"
            onClick={() =>
              setRequest((value) => ({
                ...value,
                sequence: value.sequence + 1,
              }))
            }
          >
            {t("extra.auth_retry")}
          </button>
        </div>
      )}
      {window && (
        <button
          type="button"
          className="schedule-edge"
          disabled={loading}
          onClick={() => extend("later")}
        >
          {t("extra.schedule_later")}
        </button>
      )}
    </div>
  );
}
