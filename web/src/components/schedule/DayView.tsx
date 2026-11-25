"use client";

import { useLayoutEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { EmptyState } from "@/components/shell/EmptyState";
import { useAccount } from "@/lib/account";
import type { Schemas } from "@/lib/api/client";
import { useTranslation } from "@/lib/i18n";
import { meetingCreationHref } from "@/lib/schedule-view";
import { zonedDay, zonedInstant } from "@/lib/zoned-date";
import { CurrentTimeLine } from "./CurrentTimeLine";
import { HourScale, hours } from "./HourScale";
import { MeetingBlock } from "./MeetingBlock";
import { endOfMeeting, minuteOfDay } from "./schedule-data";

const minutesInDay = 1440;
const hourInMillis = 3_600_000;

interface PositionedMeeting {
  meeting: Schemas["Meeting"];
  start: number;
  end: number;
  lane: number;
  lanes: number;
}

function planBlocks(
  meetings: Schemas["Meeting"][],
  day: string,
  timeZone: string,
): PositionedMeeting[] {
  const placed: PositionedMeeting[] = [];
  let cluster: PositionedMeeting[] = [];
  let laneEnds: number[] = [];

  function finishCluster(): void {
    placed.push(...cluster.map((block) => ({ ...block, lanes: laneEnds.length })));
    cluster = [];
    laneEnds = [];
  }

  const positions = meetings
    .filter((meeting) => zonedDay(meeting.starts_at, timeZone) === day)
    .map((meeting) => ({ meeting, start: minuteOfDay(meeting.starts_at, timeZone) }))
    .sort((first, second) => first.start - second.start);

  for (const { meeting, start } of positions) {
    if (laneEnds.length > 0 && laneEnds.every((end) => end <= start)) finishCluster();

    // spec:impl schedule-day-view#make-block-height-proportional-planned
    // spec:impl schedule-day-view#show-meeting-crosses-midnight-person
    // spec:impl schedule-day-view#draw-meeting-longer-8-hours
    const end =
      zonedDay(endOfMeeting(meeting), timeZone) === day
        ? Math.min(minutesInDay, start + meeting.duration_minutes)
        : minutesInDay;
    const available = laneEnds.findIndex((candidate) => candidate <= start);
    const lane = available >= 0 ? available : laneEnds.length;
    laneEnds[lane] = end;
    cluster.push({ meeting, start, end, lane, lanes: 1 });
  }

  finishCluster();
  return placed;
}

function freeHours(
  meetings: Schemas["Meeting"][],
  day: string,
  timeZone: string,
): Map<number, string> {
  const occupied = meetings.map(
    (meeting) => [Date.parse(meeting.starts_at), endOfMeeting(meeting).getTime()] as const,
  );
  const result = new Map<number, string>();
  hours.forEach((clock, hour) => {
    const iso = zonedInstant(day, clock, timeZone);
    if (!iso) return;
    const start = Date.parse(iso);
    if (!occupied.some(([from, to]) => from < start + hourInMillis && start < to))
      result.set(hour, iso);
  });
  return result;
}

interface DayViewProps {
  day: string;
  meetings: Schemas["Meeting"][];
  leader: boolean;
  onCreateAt: (startsAt: string) => void;
  onOpen: (id: string) => void;
  onMove: (distance: number) => void;
  now: Date;
}

export function DayView({
  day,
  meetings,
  leader,
  onCreateAt,
  onOpen,
  onMove,
  now,
}: DayViewProps): ReactElement {
  const { account } = useAccount();
  const t = useTranslation();
  const timeZone = account.time_zone;
  const isToday = zonedDay(now, timeZone) === day;
  const minute = minuteOfDay(now, timeZone);
  const [anchor] = useState(() => Math.floor(minute / 60) / 24);
  const [selected, setSelected] = useState<number | null>(null);
  const timeline = useRef<HTMLDivElement>(null);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const blocks = useMemo(() => planBlocks(meetings, day, timeZone), [day, meetings, timeZone]);
  // spec:impl schedule-day-view#offer-non-leader-empty-hour-selection
  const available = useMemo(
    () => (leader ? freeHours(meetings, day, timeZone) : new Map<number, string>()),
    [day, leader, meetings, timeZone],
  );
  const chosen = selected === null ? undefined : available.get(selected);
  const duration = account.leader?.session_duration_minutes ?? 60;

  useLayoutEffect(() => {
    const viewport = timeline.current;
    // spec:impl schedule-day-view#position-scale-day-view-opens
    if (viewport) viewport.scrollTop = viewport.scrollHeight * anchor;
  }, [anchor]);

  return (
    <div
      className="schedule-day-view"
      onTouchStart={(event) => {
        const start = event.touches[0];
        touch.current =
          event.touches.length === 1 && start ? { x: start.clientX, y: start.clientY } : null;
      }}
      onTouchEnd={(event) => {
        const start = touch.current;
        touch.current = null;
        const end = event.changedTouches[0];
        if (!start || !end) return;
        const x = end.clientX - start.x;
        // spec:impl schedule-day-view#move-next-day-swipe-left
        if (Math.abs(x) >= 55 && Math.abs(x) > Math.abs(end.clientY - start.y) * 1.5)
          onMove(x < 0 ? 1 : -1);
      }}
      onTouchCancel={() => {
        touch.current = null;
      }}
    >
      {blocks.length === 0 && (
        <div className="schedule-day-empty">
          <EmptyState
            character="meetings_empty_day"
            textKey="meetings.empty_day"
            action={
              leader
                ? { labelKey: "meetings.empty_day_cta", href: meetingCreationHref(day) }
                : undefined
            }
          />
        </div>
      )}
      <div
        ref={timeline}
        className="schedule-scroll schedule-day-scroll"
        role="region"
        aria-label={t("meetings.view_day")}
        tabIndex={0}
      >
        {/* spec:impl schedule-day-view#show-selected-day-screen-3-1 */}
        <div className="schedule-day-track">
          <HourScale available={available} selected={selected} onSelect={setSelected} />
          <div className="schedule-blocks">
            {blocks.map(({ meeting, start, end, lane, lanes }) => (
              <MeetingBlock
                key={meeting.id}
                meeting={meeting}
                timeZone={timeZone}
                onOpen={onOpen}
                style={{
                  top: `${start / 14.4}%`,
                  height: `${(end - start) / 14.4}%`,
                  left: `${(lane / lanes) * 100}%`,
                  width: `${100 / lanes}%`,
                }}
              />
            ))}
            {/* spec:impl schedule-day-view#highlight-leader-taps-empty-hour */}
            {chosen && selected !== null && (
              <div
                className="schedule-hour-selection"
                style={{
                  top: `${(selected / 24) * 100}%`,
                  height: `${Math.min(duration, minutesInDay - selected * 60) / 14.4}%`,
                }}
              >
                {/* spec:impl schedule-day-view#open-meeting-form-date-start */}
                <button
                  type="button"
                  className="schedule-create-in-hour"
                  onClick={() => onCreateAt(chosen)}
                >
                  {t("meetings.create")}
                </button>
              </div>
            )}
          </div>
          {/* spec:impl schedule-day-view#draw-red-current-time-line-scale */}
          {isToday && (
            <CurrentTimeLine instant={now} timeZone={timeZone} top={`${minute / 14.4}%`} />
          )}
        </div>
      </div>
    </div>
  );
}
