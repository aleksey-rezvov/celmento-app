"use client";

import { Fragment, type ReactElement } from "react";
import { EmptyState } from "@/components/shell/EmptyState";
import { useLanguage } from "@/lib/i18n";
import { civilDate } from "@/lib/zoned-date";
import { AttendedBlock } from "./AttendedBlock";
import { CurrentTimeLine } from "./CurrentTimeLine";
import { MeetingFeedCard } from "./MeetingFeedCard";
import { endOfMeeting, scheduleItemKey, type ScheduleItem } from "./schedule-data";

interface FeedDayRowProps {
  day: string;
  today: boolean;
  meetings: ScheduleItem[];
  now: Date;
  timeZone: string;
  onPickDay: (day: string) => void;
  onOpen: (id: string) => void;
  onOpenAttended: (id: string) => void;
}

export function FeedDayRow({
  day,
  today,
  meetings,
  now,
  timeZone,
  onPickDay,
  onOpen,
  onOpenAttended,
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
    ({ meeting }) => endOfMeeting(meeting).getTime() > now.getTime(),
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
        {/* spec:impl schedule-feed-view#show-today-row-even-today */}
        {meetings.length === 0 ? (
          <EmptyState character="meetings_today_empty" textKey="meetings.today_empty" />
        ) : (
          meetings.map((item, index) => (
            <Fragment key={scheduleItemKey(item)}>
              {/* spec:impl schedule-feed-view#draw-current-time-line-inside-today */}
              {index === firstUpcoming && line}
              {/* spec:impl schedule-feed-view#open-meeting-card-person-meeting */}
              {item.kind === "attended" ? (
                <AttendedBlock
                  meeting={item.meeting}
                  timeZone={timeZone}
                  now={now}
                  onOpen={onOpenAttended}
                  feed
                />
              ) : (
                <MeetingFeedCard meeting={item.meeting} timeZone={timeZone} onOpen={onOpen} />
              )}
            </Fragment>
          ))
        )}
        {firstUpcoming === -1 && line}
      </div>
    </div>
  );
}
