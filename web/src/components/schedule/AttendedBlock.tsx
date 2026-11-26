import type { CSSProperties, ReactElement } from "react";
import { LeaderAvatar } from "@/components/booking/LeaderAvatar";
import { bookingFormatLabels, leaderName } from "@/components/booking/booking-display";
import { attendedStatus, specialistTimeHint } from "@/components/specialists/specialist-display";
import type { Schemas } from "@/lib/api/client";
import { formatTime } from "@/lib/format";
import { useLanguage, useTranslation } from "@/lib/i18n";
import { endOfMeeting } from "./schedule-data";

interface AttendedBlockProps {
  meeting: Schemas["AttendedMeeting"];
  timeZone: string;
  now: Date;
  onOpen: (id: string) => void;
  style?: CSSProperties;
  feed?: boolean;
}

export function AttendedBlock({
  meeting,
  timeZone,
  now,
  onOpen,
  style,
  feed = false,
}: AttendedBlockProps): ReactElement {
  const t = useTranslation();
  const language = useLanguage();
  const specialist = meeting.specialist;
  const name = leaderName(specialist.first_name, specialist.last_name);
  const end = endOfMeeting(meeting).toISOString();
  const hint = specialistTimeHint(meeting, timeZone, language);
  const status = feed ? attendedStatus(meeting, now) : null;

  // spec:impl attended-meetings#show-attended-meetings-day-view
  // spec:impl schedule-day-view#show-attended-meetings-day-blocks
  // spec:impl schedule-feed-view#show-attended-meetings-feed-grey
  return (
    <button
      className={
        feed ? "schedule-meeting schedule-feed-card" : "schedule-meeting schedule-day-block"
      }
      type="button"
      data-attended="true"
      style={style}
      onClick={() => onOpen(meeting.id)}
    >
      <span className="schedule-meeting-content">
        <span className="schedule-meeting-time">
          <time dateTime={meeting.starts_at}>
            {formatTime(meeting.starts_at, timeZone, language)}
          </time>
          <span aria-hidden="true">–</span>
          <time dateTime={end}>{formatTime(end, timeZone, language)}</time>
          {hint && (
            <span className="schedule-time-hint">
              {feed && " · "}
              {hint}
            </span>
          )}
        </span>
        <span className="schedule-meeting-name">{name}</span>
        {feed && (
          <span className="schedule-meeting-place">{t(bookingFormatLabels[meeting.place])}</span>
        )}
        {status && <span className="schedule-meeting-status">{t(status)}</span>}
      </span>
      <LeaderAvatar
        firstName={specialist.first_name}
        lastName={specialist.last_name}
        photoUrl={specialist.photo_url}
        size={feed ? 36 : 26}
      />
    </button>
  );
}
