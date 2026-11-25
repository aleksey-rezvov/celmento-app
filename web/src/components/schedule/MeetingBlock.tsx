"use client";

import type { CSSProperties, ReactElement } from "react";
import { ClientAvatar } from "@/components/clients/ClientAvatar";
import type { Schemas } from "@/lib/api/client";
import { otherPartyHint } from "@/lib/format";
import { useLanguage, useTranslation } from "@/lib/i18n";
import { meetingTitle } from "@/lib/meeting-display";
import { zonedClock } from "@/lib/zoned-date";
import { endOfMeeting } from "./schedule-data";

interface MeetingBlockProps {
  meeting: Schemas["Meeting"];
  timeZone: string;
  onOpen: (id: string) => void;
  style?: CSSProperties;
}

interface MeetingSurfaceProps extends MeetingBlockProps {
  feed: boolean;
}

export function MeetingSurface({
  meeting,
  timeZone,
  onOpen,
  style,
  feed,
}: MeetingSurfaceProps): ReactElement {
  const t = useTranslation();
  const language = useLanguage();
  const client = meeting.client;
  const cancelled = meeting.status === "not_taken_place";
  const name = meetingTitle(meeting, t);
  const end = endOfMeeting(meeting);
  const startClock = zonedClock(meeting.starts_at, timeZone);
  const endClock = zonedClock(end, timeZone);
  const place =
    meeting.place === "online"
      ? t("form.place_online")
      : meeting.address || t("form.place_offline");
  const clientTime = feed
    ? otherPartyHint(
        meeting.starts_at,
        timeZone,
        client?.linked ? client.time_zone : null,
        "client.client_time",
        language,
      )
    : null;

  // spec:impl schedule-day-view#color-blocks-type-client-session
  // spec:impl schedule-feed-view#color-card-meeting-type-colors
  // spec:impl schedule-day-view#render-meeting-client-archived-grey
  // spec:impl schedule-day-view#render-block-not-taken-place-meeting
  // spec:impl schedule-feed-view#show-card-status-marks-day
  return (
    <button
      className={
        feed ? "schedule-meeting schedule-feed-card" : "schedule-meeting schedule-day-block"
      }
      type="button"
      data-type={meeting.type}
      data-archived={client?.archived || undefined}
      data-status={meeting.status}
      style={style}
      onClick={() => onOpen(meeting.id)}
    >
      <span className="schedule-meeting-content">
        {/* spec:impl schedule-day-view#show-block-start-end-time */}
        {/* spec:impl schedule-feed-view#show-card-person-meeting-client */}
        <span className="schedule-meeting-time">
          <time dateTime={meeting.starts_at}>{startClock}</time>
          <span aria-hidden="true">–</span>
          <time dateTime={end.toISOString()}>{endClock}</time>
          {clientTime && <span className="schedule-time-hint"> · {clientTime}</span>}
        </span>
        <span className="schedule-meeting-name">
          {cancelled ? <s>{name}</s> : name}
          {/* spec:impl schedule-day-view#mark-block-completed-meeting */}
          {meeting.status === "completed" && (
            <span className="schedule-completed" aria-label={t("outcome.done")} role="img">
              ✓
            </span>
          )}
        </span>
        {feed && <span className="schedule-meeting-place">{place}</span>}
        {/* spec:impl schedule-day-view#show-need-outcome-badge-block-meeting */}
        {meeting.awaiting_outcome && (
          <span className="schedule-outcome-badge">{t("meetings.need_outcome_badge")}</span>
        )}
      </span>
      {meeting.type === "client_session" && client && (
        <ClientAvatar
          clientId={client.id}
          name={client.name}
          photoUrl={client.photo_url}
          size={36}
        />
      )}
    </button>
  );
}

export function MeetingBlock(props: MeetingBlockProps): ReactElement {
  return <MeetingSurface {...props} feed={false} />;
}
