"use client";

import { useParams } from "next/navigation";
import type { ReactElement } from "react";
import { BookingLoadState } from "@/components/booking/BookingScreen";
import { CalendarButton } from "@/components/booking/CalendarButton";
import { LeaderHeader } from "@/components/booking/LeaderHeader";
import { bookingFormatLabels } from "@/components/booking/booking-display";
import { callHref } from "@/components/booking/booking-paths";
import { SpecialistContacts } from "@/components/specialists/SpecialistContacts";
import { SpecialistScreen } from "@/components/specialists/SpecialistScreen";
import { loadAttendedCalendar, useAttendedMeeting } from "@/components/specialists/specialist-data";
import {
  attendedStatus,
  bookingDateTime,
  meetingsPath,
  specialistTimeHint,
} from "@/components/specialists/specialist-display";
import { useAccount } from "@/lib/account";
import type { Schemas } from "@/lib/api/client";
import { formatMoney } from "@/lib/format";
import { useTranslation } from "@/lib/i18n";
import { useCurrentInstant } from "@/lib/schedule-view";

interface AttendedMeetingDetailsProps {
  meeting: Schemas["AttendedMeeting"];
  onMissing: () => void;
}

function AttendedMeetingDetails({ meeting, onMissing }: AttendedMeetingDetailsProps): ReactElement {
  const { account, currentSessionToken } = useAccount();
  const t = useTranslation();
  const now = useCurrentInstant();
  const status = attendedStatus(meeting, now);
  const hint = specialistTimeHint(meeting, account.time_zone, account.language);
  const specialist = meeting.specialist;
  const call = meeting.place === "online" ? callHref(meeting.meeting_link) : null;
  const amount = formatMoney(meeting.price, account.language);
  const price =
    meeting.payment_type === "paid"
      ? t("public.price", { amount, сумма: amount })
      : t(meeting.payment_type === "barter" ? "form.barter" : "form.pro_bono");

  // spec:impl attended-meetings#show-screen-9-9-leader-photo
  // spec:impl attended-meetings#show-actual-duration-leader-comment
  // spec:impl attended-meetings#offer-cancel-reschedule-delete-outcome
  return (
    <section className="booking-card booking-profile-card">
      <LeaderHeader
        firstName={specialist.first_name}
        lastName={specialist.last_name}
        photoUrl={specialist.photo_url}
        specializations={[]}
        specializationOther={null}
        heading="h2"
      />
      <div className="specialist-facts">
        <time dateTime={meeting.starts_at}>
          {bookingDateTime(meeting.starts_at, account.time_zone, account.language)}
        </time>
        {hint && <p className="booking-hint">{hint}</p>}
        <p>{t("public.duration", { N: meeting.duration_minutes })}</p>
        <p>{t(bookingFormatLabels[meeting.place])}</p>
        {/* spec:impl attended-meetings#show-in-person-meeting-address */}
        {meeting.place === "in_person" && meeting.address && (
          <p>
            {t("form.address")} · {meeting.address}
          </p>
        )}
        {call && <p>{meeting.meeting_link}</p>}
        {status && <p>{t(status)}</p>}
        <p>{price}</p>
      </div>
      {/* spec:impl attended-meetings#offer-screen-9-9-open-meeting-meeting */}
      {call && (
        <a className="shell-primary" href={call} target="_blank" rel="noopener noreferrer">
          {t("card.open_meeting")}
        </a>
      )}
      <CalendarButton
        label="done.add_calendar"
        load={(signal) => loadAttendedCalendar(meeting.id, currentSessionToken, signal)}
        onMissing={onMissing}
      />
      {/* spec:impl attended-meetings#show-screen-9-9-contact-buttons */}
      <SpecialistContacts specialist={specialist} />
      <p className="booking-hint">{t("c.contact_to_change")}</p>
    </section>
  );
}

export default function AttendedMeetingPage(): ReactElement {
  const { id } = useParams<{ id: string }>();
  const { result, retry } = useAttendedMeeting(id);
  const t = useTranslation();

  return (
    <SpecialistScreen back={meetingsPath} title={t("meetings.title")}>
      {result?.kind === "ready" ? (
        <AttendedMeetingDetails meeting={result.data} onMissing={retry} />
      ) : result?.kind === "missing" ? (
        // spec:impl attended-meetings#update-attended-meeting-details-leader
        <p className="booking-card" role="status">
          {t("extra.meeting_missing")}
        </p>
      ) : (
        <BookingLoadState
          error={result?.kind === "offline" ? "offline" : result ? "error" : undefined}
          retry={retry}
        />
      )}
    </SpecialistScreen>
  );
}
