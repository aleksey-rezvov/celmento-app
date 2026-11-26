"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState, type ReactElement } from "react";
import { Character } from "@/components/Character";
import { BookingForm } from "@/components/booking/BookingForm";
import { BookingLoadState } from "@/components/booking/BookingScreen";
import { emptyBookingDraft, type BookingFormValues } from "@/components/booking/BookingSession";
import { BookingSlotPicker } from "@/components/booking/BookingSlotPicker";
import { CalendarButton } from "@/components/booking/CalendarButton";
import { bookingDaysAhead } from "@/components/booking/DateStrip";
import { MainContactButton } from "@/components/booking/MainContactButton";
import { leaderName } from "@/components/booking/booking-display";
import { SpecialistScreen } from "@/components/specialists/SpecialistScreen";
import { claimBookingIntent } from "@/components/specialists/booking-intent";
import {
  loadAttendedCalendar,
  readSpecialist,
  useSpecialist,
  useSpecialistSlots,
} from "@/components/specialists/specialist-data";
import {
  bookingDateTime,
  meetingsPath,
  specialistPath,
} from "@/components/specialists/specialist-display";
import { Sheet } from "@/components/shell/Sheet";
import { useAccount } from "@/lib/account";
import { apiClient, errorCode, type Schemas } from "@/lib/api/client";
import { useTranslation, type MessageKey } from "@/lib/i18n";
import { useIdempotencyKey } from "@/lib/idempotency";
import { peoplePath } from "@/lib/limit";
import { useCurrentInstant } from "@/lib/schedule-view";
import { shiftCivilDay, zonedDay } from "@/lib/zoned-date";

type Outcome =
  | { kind: "booked"; meeting: Schemas["AttendedMeeting"] }
  | { kind: "unavailable"; contact: Schemas["MainContact"] | null }
  | { kind: "missing" };

function retryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function responseContact(error: unknown): Schemas["MainContact"] | null | undefined {
  if (!error || typeof error !== "object" || !("details" in error)) return undefined;

  const { details } = error;
  if (!details || typeof details !== "object" || !("main_contact" in details)) return undefined;

  const contact = details.main_contact;
  if (contact === null) return null;
  if (
    !contact ||
    typeof contact !== "object" ||
    !("channel" in contact) ||
    !("value" in contact) ||
    typeof contact.value !== "string"
  )
    return undefined;

  const { channel, value } = contact;
  return channel === "phone" ||
    channel === "telegram" ||
    channel === "whatsapp" ||
    channel === "email" ||
    channel === "other"
    ? { channel, value }
    : undefined;
}

interface UnavailableProps {
  name: string;
  contact: Schemas["MainContact"] | null;
}

function BookingUnavailable({ name, contact }: UnavailableProps): ReactElement {
  const t = useTranslation();

  // spec:impl client-app-booking#show-screen-9-4-notify-leader
  return (
    <>
      <Character state="booking_unavailable" size={200} />
      <section className="booking-card booking-centered">
        <h2 className="booking-message">{t("unavailable.text", { name, имя: name })}</h2>
        <MainContactButton contact={contact} />
      </section>
    </>
  );
}

function BookingConfirmed({ meeting }: { meeting: Schemas["AttendedMeeting"] }): ReactElement {
  const { account, currentSessionToken } = useAccount();
  const t = useTranslation();

  // spec:impl client-app-booking#show-title-after-successful-booking
  return (
    <>
      <Character state="booking_done" size={200} />
      <section className="booking-card booking-centered">
        <h2>{t("done.title")}</h2>
        <time dateTime={meeting.starts_at}>
          {bookingDateTime(meeting.starts_at, account.time_zone, account.language)}
        </time>
        <CalendarButton
          label="done.add_calendar"
          load={(signal) => loadAttendedCalendar(meeting.id, currentSessionToken, signal)}
        />
        <Link className="shell-primary" href={meetingsPath}>
          {t("meetings.title")}
        </Link>
      </section>
    </>
  );
}

function AppBooking({ card: initialCard }: { card: Schemas["SpecialistCard"] }): ReactElement {
  const { account, currentSessionToken } = useAccount();
  const [card, setCard] = useState(initialCard);
  const t = useTranslation();
  const now = useCurrentInstant();
  const zone = account.time_zone;
  const today = zonedDay(now, zone);
  const [selectedDay, setSelectedDay] = useState(today);
  const day =
    selectedDay >= today && selectedDay <= shiftCivilDay(today, bookingDaysAhead)
      ? selectedDay
      : today;
  const [startsAt, setStartsAt] = useState<string | null>(null);
  const [values, setValues] = useState<BookingFormValues>(() => ({ ...emptyBookingDraft.values }));
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [slotTaken, setSlotTaken] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const pending = useRef(false);
  const archiveAttempt = useRef<{ key: string; refreshAfterRestore: boolean } | null>(null);
  const idempotency = useIdempotencyKey();

  const { specialist } = card;
  const name = leaderName(specialist.first_name, specialist.last_name);
  const slots = useSpecialistSlots(
    specialist.id,
    day,
    zone,
    card.booking_available && startsAt === null && outcome === null,
  );
  const refreshSlots = slots.retry;
  const result = slots.result;
  const available = result?.kind === "ready" ? result.data : null;
  const archivedBeforeSubmit =
    outcome === null && (!card.booking_available || result?.kind === "unavailable");

  useEffect(() => {
    const token = currentSessionToken();
    if (!token) return;
    const session: string = token;

    const key = claimBookingIntent(specialist.id, session);
    if (key) archiveAttempt.current = { key, refreshAfterRestore: false };
    const attempt = archiveAttempt.current;
    if (!archivedBeforeSubmit || !attempt) return;

    const controller = new AbortController();
    const { signal } = controller;
    let timer: number | undefined;
    let delay = 750;
    const active = (): boolean => !signal.aborted && currentSessionToken() === session;

    function retry(): void {
      if (!active()) return;
      timer = window.setTimeout(() => void report(), delay);
      delay = Math.min(delay * 2, 8000);
    }

    const report = async (): Promise<void> => {
      if (!active()) return;

      try {
        if (!attempt.refreshAfterRestore) {
          const { error, response } = await apiClient(session).POST("/bookings", {
            body: { specialist_id: specialist.id },
            params: { header: { "Idempotency-Key": attempt.key } },
            signal,
          });
          if (!active()) return;

          const code = errorCode(error);
          if (response.status === 409 && code === "booking_unavailable") {
            const contact = responseContact(error);
            archiveAttempt.current = null;
            setOutcome({
              kind: "unavailable",
              contact: contact === undefined ? card.main_contact : contact,
            });
            return;
          }
          if (retryableStatus(response.status)) {
            retry();
            return;
          }
          if (response.status === 422 || code === "conflict") {
            attempt.refreshAfterRestore = true;
          } else {
            archiveAttempt.current = null;
            if ([401, 403, 404].includes(response.status)) setOutcome({ kind: "missing" });
            return;
          }
        }

        const latest = await readSpecialist(session, specialist.id, signal);
        if (!active()) return;
        if (retryableStatus(latest.response.status)) {
          retry();
          return;
        }
        archiveAttempt.current = null;
        if (latest.data) {
          setCard(latest.data);
          refreshSlots();
        } else if ([401, 403, 404].includes(latest.response.status)) {
          setOutcome({ kind: "missing" });
        }
      } catch {
        retry();
      }
    };

    void report();
    return () => {
      controller.abort();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [archivedBeforeSubmit, card.main_contact, currentSessionToken, refreshSlots, specialist.id]);

  function chooseTime(): void {
    setStartsAt(null);
    setError(null);
    refreshSlots();
  }

  async function submit(form: BookingFormValues): Promise<void> {
    if (!startsAt || pending.current || outcome || (card.session_format === "both" && !form.place))
      return;

    const session = currentSessionToken();
    if (!session) return;
    const body: Schemas["AppBookingCreate"] = {
      specialist_id: specialist.id,
      starts_at: startsAt,
      expected_session_format: card.session_format,
      place: card.session_format === "both" ? form.place : null,
      comment: form.comment.trim() || null,
    };
    pending.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const {
        data,
        error: failure,
        response,
      } = await apiClient(session).POST("/bookings", {
        body,
        params: { header: { "Idempotency-Key": idempotency.keyFor(body) } },
      });
      if (currentSessionToken() !== session) return;

      if (data) {
        idempotency.clear();
        setOutcome({ kind: "booked", meeting: data });
        return;
      }

      const code = errorCode(failure);
      if (code === "slot_taken" || code === "slot_invalid") {
        // spec:impl client-app-booking#re-check-book-slot-free-show
        idempotency.clear();
        setSlotTaken(true);
        chooseTime();
      } else if (code === "booking_unavailable") {
        idempotency.clear();
        const contact = responseContact(failure);
        setOutcome({
          kind: "unavailable",
          contact: contact === undefined ? card.main_contact : contact,
        });
      } else if (code === "conflict") {
        const latest = await readSpecialist(session, specialist.id);
        if (currentSessionToken() !== session) return;
        if (latest.data && latest.data.session_format !== card.session_format) {
          idempotency.clear();
          setCard(latest.data);
          setValues((previous) => ({ ...previous, place: null }));
        } else if ([401, 403, 404].includes(latest.response.status)) {
          setOutcome({ kind: "missing" });
        } else {
          setError("extra.auth_request_failed");
        }
      } else if ([401, 403, 404].includes(response.status)) {
        setOutcome({ kind: "missing" });
      } else {
        setError("extra.auth_request_failed");
      }
    } catch {
      if (currentSessionToken() === session) setError("extra.auth_network_error");
    } finally {
      pending.current = false;
      setSubmitting(false);
    }
  }

  if (outcome?.kind === "booked") return <BookingConfirmed meeting={outcome.meeting} />;
  if (outcome?.kind === "missing" || result?.kind === "missing")
    return (
      <p role="status" className="booking-card">
        {t("public.not_found")}
      </p>
    );

  if (outcome?.kind === "unavailable")
    return <BookingUnavailable name={name} contact={outcome.contact} />;

  if (result?.kind === "unavailable") {
    const contact = responseContact(result.error);
    return (
      <BookingUnavailable
        name={name}
        contact={contact === undefined ? card.main_contact : contact}
      />
    );
  }

  if (!card.booking_available)
    return <BookingUnavailable name={name} contact={card.main_contact} />;

  if (startsAt) {
    // spec:impl client-app-booking#open-form-9-7-after-slot
    return (
      <BookingForm
        mode="app"
        startsAt={startsAt}
        timeZone={zone}
        format={card.session_format}
        changeTime={chooseTime}
        values={values}
        onChange={setValues}
        onSubmit={submit}
        submitting={submitting}
        error={error}
      />
    );
  }

  // spec:impl client-app-booking#open-slot-picker-book-specialist
  return (
    <>
      {available?.has_available_slots === false ? (
        <section className="booking-card">
          <p className="booking-hint">{t("public.no_slots_all")}</p>
          <MainContactButton contact={card.main_contact} />
        </section>
      ) : (
        <BookingSlotPicker
          today={today}
          day={day}
          timeZone={zone}
          now={now}
          slots={available}
          error={result?.kind === "error" || result?.kind === "offline" ? result.kind : undefined}
          onDay={setSelectedDay}
          onSlot={setStartsAt}
          retry={refreshSlots}
        />
      )}
      {slotTaken && (
        <Sheet title={t("form.slot_taken")} onClose={() => setSlotTaken(false)}>
          {null}
        </Sheet>
      )}
    </>
  );
}

export default function SpecialistBookingPage(): ReactElement {
  const { id } = useParams<{ id: string }>();
  const { account } = useAccount();
  const t = useTranslation();
  const eligible = id !== account.id;
  const { result, retry } = useSpecialist(id, { enabled: eligible, live: false });

  return (
    <SpecialistScreen back={eligible ? specialistPath(id) : peoplePath} title={t("form.book")}>
      {result?.kind === "ready" && eligible ? (
        <AppBooking key={result.data.specialist.id} card={result.data} />
      ) : result?.kind === "missing" || !eligible ? (
        // spec:impl client-app-booking#offer-booking-app-leader-card
        <p role="status" className="booking-card">
          {t("public.not_found")}
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
