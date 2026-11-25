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
import { useTranslation } from "@/lib/i18n";
import { firstCivilDayOfWeek, shiftCivilDay, zonedDay } from "@/lib/zoned-date";
import { FeedDayRow } from "./FeedDayRow";
import { WeekSeparator } from "./WeekSeparator";
import { compareMeetingStarts, listScheduledMeetings, type MeetingRange } from "./schedule-data";
import { useScheduleRevalidation } from "./useScheduleRevalidation";

type Direction = "earlier" | "later";

interface Request {
  sequence: number;
  range: MeetingRange;
  direction: Direction | null;
}

interface FeedResult {
  sequence: number;
  range: MeetingRange;
  meetings: Schemas["Meeting"][];
  next_outcome_in_seconds: number | null;
}

interface FeedViewProps {
  initialDay: string;
  today: string;
  now: Date;
  onVisibleDay: (day: string) => void;
  onPickDay: (day: string) => void;
  onOpen: (id: string) => void;
  onPendingCount: (count: number) => void;
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
  onPendingCount,
}: FeedViewProps): ReactElement {
  const { account } = useAccount();
  const t = useTranslation();
  const viewport = useRef<HTMLDivElement>(null);
  const positioned = useRef(false);
  const lastScrollTop = useRef(0);
  const previousPosition = useRef<{ day: string; top: number } | null>(null);
  const [request, setRequest] = useState<Request>(() => ({
    sequence: 0,
    direction: null,
    range: { from: shiftCivilDay(initialDay, -14), to: shiftCivilDay(initialDay, 14) },
  }));
  const [window, setWindow] = useState<FeedResult | null>(null);
  const [failed, setFailed] = useState<number | null>(null);
  const error = failed === request.sequence;
  const loading = window?.sequence !== request.sequence && !error;
  const refresh = useCallback((): void => {
    if (!loading && window) {
      setRequest((value) => ({
        sequence: value.sequence + 1,
        direction: null,
        range: window.range,
      }));
    }
  }, [loading, window]);
  useScheduleRevalidation(window, refresh);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    async function load(): Promise<void> {
      try {
        const data = await listScheduledMeetings(request.range, signal);
        if (signal.aborted) return;
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
              meetings: data.items,
              next_outcome_in_seconds: data.next_outcome_in_seconds,
            };
          return {
            sequence: request.sequence,
            next_outcome_in_seconds: data.next_outcome_in_seconds,
            range: {
              from: earlier ? request.range.from : existing.range.from,
              to: earlier ? existing.range.to : request.range.to,
            },
            meetings: earlier
              ? [...data.items, ...existing.meetings]
              : [...existing.meetings, ...data.items],
          };
        });
        onPendingCount(data.pending_outcomes_count);
      } catch {
        if (!signal.aborted) setFailed(request.sequence);
      }
    }
    void load();
    return () => controller.abort();
  }, [onPendingCount, request]);

  const days = useMemo(() => {
    const result = new Map<string, Schemas["Meeting"][]>();
    if (!window) return result;

    // spec:impl schedule-feed-view#hide-day-without-meetings-feed
    for (const meeting of window.meetings.toSorted(compareMeetingStarts)) {
      const day = zonedDay(meeting.starts_at, account.time_zone);
      const existing = result.get(day);
      if (existing) existing.push(meeting);
      else result.set(day, [meeting]);
    }
    if (today >= window.range.from && today <= window.range.to && !result.has(today))
      result.set(today, []);
    return result;
  }, [account.time_zone, today, window]);

  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element || !window) return;

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
            />
          </Fragment>
        );
      })}
      {error && (
        <div role="alert" className="schedule-error">
          <p>{t("extra.auth_request_failed")}</p>
          <button
            className="shell-secondary"
            type="button"
            onClick={() => setRequest((value) => ({ ...value, sequence: value.sequence + 1 }))}
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
