import Link from "next/link";
import type { ReactElement } from "react";
import type { Schemas } from "@/lib/api/client";
import { useLanguage, useTranslation } from "@/lib/i18n";
import { meetingPerson, meetingTitle } from "@/lib/meeting-display";
import { recordsDate } from "@/lib/records-period";
import { formatRecordsHours, recordsMeetingPath } from "./records-display";

interface HoursMeetingRowProps {
  meeting: Schemas["RecordsHoursMeeting"];
}

export function HoursMeetingRow({ meeting }: HoursMeetingRowProps): ReactElement {
  const t = useTranslation();
  const language = useLanguage();
  const details = {
    type: meeting.meeting_type,
    client: meeting.client,
    with_whom: meeting.with_whom,
  };
  const mutual = meeting.meeting_type === "mutual_practice";
  const name = mutual ? meetingTitle(details, t) : meetingPerson(details, t);
  const badge =
    mutual || meeting.payment_type === "pro_bono"
      ? "form.pro_bono"
      : meeting.payment_type === "barter"
        ? "form.barter"
        : null;

  // spec:impl hours-log#list-below-breakdown-log-meetings
  // spec:impl hours-log#open-meeting-card-listed-meeting
  return (
    <li>
      <Link className="records-list-row records-hours-row" href={recordsMeetingPath(meeting.id)}>
        <div className="records-row-description">
          <span>{name}</span>
          <time className="records-row-meta" dateTime={meeting.date}>
            {recordsDate(meeting.date, language)}
          </time>
          {badge && <span className="client-row-tag">{t(badge)}</span>}
        </div>
        <span className="records-hours-amount">
          {t("extra.records_hours_amount", { H: formatRecordsHours(meeting.hours, language) })}
        </span>
        <span className="records-row-chevron" aria-hidden="true">
          ›
        </span>
      </Link>
    </li>
  );
}
