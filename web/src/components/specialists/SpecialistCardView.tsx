import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactElement } from "react";
import { LeaderHeader } from "@/components/booking/LeaderHeader";
import { MainContactButton } from "@/components/booking/MainContactButton";
import { bookingFormatLabels } from "@/components/booking/booking-display";
import { NotesGrid } from "@/components/notes/grid/NotesGrid";
import { ConfirmSheet } from "@/components/shell/ConfirmSheet";
import { useAccount } from "@/lib/account";
import type { Schemas } from "@/lib/api/client";
import { formatMoney } from "@/lib/format";
import { useTranslation } from "@/lib/i18n";
import { peoplePath } from "@/lib/limit";
import { useCurrentInstant } from "@/lib/schedule-view";
import { SpecialistContacts } from "./SpecialistContacts";
import { rememberBookingIntent } from "./booking-intent";
import { unlinkSpecialist } from "./specialist-data";
import {
  attendedMeetingPath,
  attendedStatus,
  bookingDateTime,
  specialistPath,
  specialistTimeHint,
} from "./specialist-display";

interface SpecialistMeetingRowsProps {
  heading: "c.upcoming" | "c.past";
  meetings: Schemas["AttendedMeeting"][];
}

function SpecialistMeetingRows({
  heading,
  meetings,
}: SpecialistMeetingRowsProps): ReactElement | null {
  const { account } = useAccount();
  const t = useTranslation();
  const now = useCurrentInstant();
  if (meetings.length === 0) return null;

  return (
    <section className="specialist-section">
      <h2>{t(heading)}</h2>
      <ul className="specialist-meeting-rows">
        {meetings.map((meeting) => {
          const status = attendedStatus(meeting, now);
          const hint = specialistTimeHint(meeting, account.time_zone, account.language);
          return (
            <li key={meeting.id}>
              <Link className="specialist-booking-row" href={attendedMeetingPath(meeting.id)}>
                <time dateTime={meeting.starts_at}>
                  {bookingDateTime(meeting.starts_at, account.time_zone, account.language)}
                </time>
                <span>{t(bookingFormatLabels[meeting.place])}</span>
                {hint && <span>{hint}</span>}
                {status && <span>{t(status)}</span>}
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

interface SpecialistCardViewProps {
  card: Schemas["SpecialistCard"];
}

export function SpecialistCardView({ card }: SpecialistCardViewProps): ReactElement {
  const { account, currentSessionToken } = useAccount();
  const router = useRouter();
  const t = useTranslation();
  const [confirmUnlink, setConfirmUnlink] = useState(false);
  const [unlinking, setUnlinking] = useState(false);
  const [unlinkFailed, setUnlinkFailed] = useState(false);
  const { specialist } = card;
  const bookable = card.booking_available && specialist.id !== account.id;
  const amount =
    card.price_for_me && Number(card.price_for_me.amount) > 0
      ? formatMoney(card.price_for_me, account.language)
      : null;
  const price =
    card.payment_type === "paid"
      ? amount && t("c.price_for_me", { amount, сумма: amount })
      : t(card.payment_type === "barter" ? "form.barter" : "form.pro_bono");
  const notes = card.shared_notes
    .filter((note) => note.shared_with_me && note.author.id === specialist.id)
    .slice(0, 3);

  async function confirm(): Promise<void> {
    if (unlinking) return;
    setUnlinking(true);
    setUnlinkFailed(false);
    try {
      await unlinkSpecialist(specialist.id, currentSessionToken);
      router.replace(peoplePath);
    } catch {
      setUnlinkFailed(true);
      setUnlinking(false);
    }
  }

  return (
    <>
      <section className="booking-card booking-profile-card">
        {/* spec:impl client-my-specialists#show-card-9-6-leader-photo */}
        <LeaderHeader
          firstName={specialist.first_name}
          lastName={specialist.last_name}
          photoUrl={specialist.photo_url}
          specializations={specialist.specializations}
          specializationOther={specialist.specialization_other}
          heading="h2"
        />
        {card.about.trim() && (
          <div className="specialist-facts">
            <h2>{t("profile.about_text")}</h2>
            <p className="specialist-about">{card.about}</p>
          </div>
        )}
        {/* spec:impl client-my-specialists#show-contact-buttons-card-9-6 */}
        <SpecialistContacts
          specialist={specialist}
          mainContact={card.main_contact}
          excludeMain={!bookable}
        />
        <p className="booking-hint">{t("c.contact_to_change")}</p>
        {/* spec:impl client-my-specialists#show-price-for-me-card-9-6-rate */}
        {price && <p className="specialist-facts">{price}</p>}
        {bookable ? (
          // spec:impl client-my-specialists#show-book-card-9-6-starts
          // spec:impl client-app-booking#offer-booking-account-linked-card
          <Link
            className="shell-primary"
            href={specialistPath(specialist.id) + "/book"}
            onNavigate={(event) => {
              const session = currentSessionToken();
              if (session) rememberBookingIntent(specialist.id, session);
              else event.preventDefault();
            }}
          >
            {t("form.book")}
          </Link>
        ) : (
          // spec:impl client-my-specialists#replace-book-unavailable-bar-leader
          <div className="specialist-unavailable">
            <p>{t("c.unavailable")}</p>
            <MainContactButton contact={card.main_contact} />
          </div>
        )}
      </section>
      {/* spec:impl client-my-specialists#list-card-9-6-upcoming-attended */}
      <SpecialistMeetingRows heading="c.upcoming" meetings={card.upcoming_meetings} />
      <SpecialistMeetingRows heading="c.past" meetings={card.past_meetings} />
      {notes.length > 0 && (
        // spec:impl client-my-specialists#list-card-9-6-3-latest
        <section className="specialist-section">
          <h2>{t("notes.title")}</h2>
          <NotesGrid
            folders={[]}
            notes={notes}
            onOpenNote={(id) => router.push("/app/notes/" + encodeURIComponent(id))}
            onOpenFolder={() => undefined}
          />
        </section>
      )}
      <button
        type="button"
        className="specialist-unlink"
        onClick={() => {
          setUnlinkFailed(false);
          setConfirmUnlink(true);
        }}
      >
        {t("client.unlink")}
      </button>
      {/* spec:impl client-my-specialists#show-unlink-card-9-6-confirming */}
      {confirmUnlink && (
        <ConfirmSheet
          title={t("client.unlink")}
          text={t("extra.specialist_unlink_warning")}
          confirmLabel={t("client.unlink")}
          destructive
          pending={unlinking}
          error={unlinkFailed ? t("extra.auth_request_failed") : null}
          onConfirm={() => void confirm()}
          onClose={() => setConfirmUnlink(false)}
        />
      )}
    </>
  );
}
