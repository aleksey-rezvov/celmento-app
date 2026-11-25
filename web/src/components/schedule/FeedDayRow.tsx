"use client";

import { Fragment, type ReactElement } from "react";
import { EmptyState } from "@/components/shell/EmptyState";
import type { Schemas } from "@/lib/api/client";
import { useLanguage } from "@/lib/i18n";
import { civilDate } from "@/lib/zoned-date";
import { CurrentTimeLine } from "./CurrentTimeLine";
import { MeetingFeedCard } from "./MeetingFeedCard";
import { endOfMeeting } from "./schedule-data";

interface FeedDayRowProps {
  day: string;
  today: boolean;
  meetings: Schemas["Meeting"][];
  now: Date;
  timeZone: string;
  onPickDay: (day: string) => void;
  onOpen: (id: string) => void;
}

export function FeedDayRow({
  day,
  today,
  meetings,
  now,
  timeZone,
  onPickDay,
  onOpen,
}: FeedDayRowProps): ReactElement {
  const language = useLanguage();
  const locale = language === "ru" ? "ru-RU" : "en-GB";
  const date = civilDate(day);
  const weekday = new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" }).format(
    date,
  );
  const label = new Intl.DateTimeFormat(locale, { dateStyle: "full", timeZone: "UTC" }).format(
    date,
  );
  const firstUpcoming = meetings.findIndex(
    (meeting) => endOfMeeting(meeting).getTime() > now.getTime(),
  );
  const line =
    today && meetings.length > 0 ? <CurrentTimeLine instant={now} timeZone={timeZone} /> : null;

  return (
    <div className="schedule-feed-row" data-feed-day={day}>
      {/* spec:impl schedule-feed-view#highlight-today-date-number-left */}
      {/* spec:impl schedule-feed-view#open-day-view-date-number */}
      <button
        className="schedule-feed-date"
        type="button"
        aria-label={label}
        aria-current={today ? "date" : undefined}
        onClick={() => onPickDay(day)}
      >
        <span>{weekday}</span>
        <span className="schedule-feed-number">{Number(day.slice(8))}</span>
      </button>
      <div className="schedule-feed-cards">
        {meetings.length === 0 ? (
          <EmptyState character="meetings_today_empty" textKey="meetings.today_empty" />
        ) : (
          meetings.map((meeting, index) => (
            <Fragment key={meeting.id}>
              {/* spec:impl schedule-feed-view#draw-current-time-line-inside-today */}
              {index === firstUpcoming && line}
              <MeetingFeedCard meeting={meeting} timeZone={timeZone} onOpen={onOpen} />
            </Fragment>
          ))
        )}
        {firstUpcoming === -1 && line}
      </div>
    </div>
  );
}
