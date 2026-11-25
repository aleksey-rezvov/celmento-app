"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactElement } from "react";
import {
  BookingLoadState,
  BookingScreen,
  PublicNotFound,
} from "@/components/booking/BookingScreen";
import { emptyBookingDraft, useBookingSession } from "@/components/booking/BookingSession";
import { bookingDaysAhead, DateStrip } from "@/components/booking/DateStrip";
import { LeaderAbout, LeaderHeader } from "@/components/booking/LeaderHeader";
import { MainContactButton } from "@/components/booking/MainContactButton";
import { SlotGrid } from "@/components/booking/SlotGrid";
import { ZoneLabel } from "@/components/booking/ZoneLabel";
import { bookingFormatLabels } from "@/components/booking/booking-display";
import { publicBookingPath } from "@/components/booking/booking-paths";
import { usePublicSlots, usePublicSpecialist } from "@/components/booking/public-resource";
import { Sheet } from "@/components/shell/Sheet";
import type { Schemas } from "@/lib/api/client";
import { deviceTimeZone } from "@/lib/device";
import { formatDate, formatMoney } from "@/lib/format";
import { useLanguage, useTranslation } from "@/lib/i18n";
import { useCurrentInstant } from "@/lib/schedule-view";
import { civilDate, shiftCivilDay, zonedDay, zonedInstant } from "@/lib/zoned-date";

function PublicSpecialist({
  specialist,
}: {
  specialist: Schemas["PublicSpecialistPage"];
}): ReactElement {
  const router = useRouter();
  const { state, update, idempotency } = useBookingSession();
  const t = useTranslation();
  const language = useLanguage();
  const now = useCurrentInstant();
  const timeZone = deviceTimeZone();
  const today = zonedDay(now, timeZone);
  const end = shiftCivilDay(today, bookingDaysAhead);
  const matches = state.draft.bookingContext === specialist.booking_context;
  const [preferredDay, setPreferredDay] = useState(() =>
    matches && state.draft.startsAt ? zonedDay(state.draft.startsAt, timeZone) : today,
  );
  const day = preferredDay >= today && preferredDay <= end ? preferredDay : today;
  const slots = usePublicSlots(specialist.login, day, timeZone);
  const result = slots.result;
  const data = result?.kind === "ready" ? result.data : null;
  const nextDate = data?.next_free_date;
  const next = nextDate && nextDate > day && nextDate <= end ? nextDate : null;
  const unavailable = data?.has_available_slots === false;
  const referenceTime = data?.items[0]?.starts_at ?? zonedInstant(day, "12:00", timeZone);
  const amount = specialist.price ? formatMoney(specialist.price, language) : null;
  const stale = state.draft.startsAt !== null && !matches;

  useEffect(() => {
    if (!stale) return;
    idempotency.clear();
    update({ draft: emptyBookingDraft, outcome: null });
  }, [idempotency, stale, update]);

  function chooseSlot(startsAt: string): void {
    update((previous) => {
      const draft =
        previous.draft.bookingContext === specialist.booking_context
          ? previous.draft
          : emptyBookingDraft;
      return {
        draft: { ...draft, startsAt, bookingContext: specialist.booking_context },
        outcome: null,
      };
    });
    // spec:impl public-booking-page#open-booking-form-guest-taps
    router.push(publicBookingPath(specialist.login) + "/book");
  }

  if (result?.kind === "missing") return <PublicNotFound />;

  // spec:impl public-booking-page#open-screen-9-1-domain-login
  // spec:impl public-booking-page#show-page-only-login-account
  // spec:impl public-booking-page#reveal-leader-meetings-clients-other
  return (
    <BookingScreen illustration="public_booking">
      <section className="booking-card booking-profile-card">
        {/* spec:impl public-booking-page#show-top-leader-photo-first */}
        <LeaderHeader
          firstName={specialist.first_name}
          lastName={specialist.last_name}
          photoUrl={specialist.photo_url}
          specializations={specialist.specializations}
          specializationOther={specialist.specialization_other}
        />
        <LeaderAbout key={specialist.about} text={specialist.about} />
        <div className="booking-details">
          {/* spec:impl public-booking-page#show-price-leader-default-rate */}
          {amount && <p>{t("public.price", { amount, сумма: amount })}</p>}
          {/* spec:impl public-booking-page#show-duration-leader-session-duration */}
          <p>
            {t("public.duration", { N: specialist.session_duration_minutes })} ·{" "}
            {t(bookingFormatLabels[specialist.session_format])}
          </p>
        </div>
        <MainContactButton contact={specialist.main_contact} />
        {/* spec:impl public-booking-page#replace-date-strip-slots-no-slots-all */}
        {unavailable && <p className="booking-hint">{t("public.no_slots_all")}</p>}
      </section>
      {!unavailable && (
        <section className="booking-card booking-picker">
          <DateStrip
            today={today}
            selected={day}
            onPick={(picked) => {
              if (picked === day) slots.retry();
              else setPreferredDay(picked);
            }}
          />
          <ZoneLabel timeZone={timeZone} at={referenceTime ? new Date(referenceTime) : now} />
          {data ? (
            data.items.length ? (
              <SlotGrid slots={data} timeZone={timeZone} onPick={chooseSlot} />
            ) : (
              <>
                {/* spec:impl public-booking-page#show-no-slots-day-next-free-button */}
                <p className="booking-hint">{t("public.no_slots_day")}</p>
                {next && (
                  <button
                    type="button"
                    className="auth-secondary"
                    onClick={() => setPreferredDay(next)}
                  >
                    {t("public.next_free", {
                      [language === "ru" ? "дата" : "date"]: formatDate(
                        civilDate(next).toISOString(),
                        "UTC",
                        language,
                      ),
                    })}
                  </button>
                )}
              </>
            )
          ) : (
            <BookingLoadState
              error={
                result?.kind === "error" || result?.kind === "offline" ? result.kind : undefined
              }
              retry={slots.retry}
            />
          )}
        </section>
      )}
      {matches && state.outcome?.kind === "slot_taken" && (
        <Sheet
          title={t("form.slot_taken")}
          onClose={() => update((previous) => ({ ...previous, outcome: null }))}
        >
          {null}
        </Sheet>
      )}
    </BookingScreen>
  );
}

export default function PublicBookingPage(): ReactElement {
  const { login } = useBookingSession();
  const specialist = usePublicSpecialist(login);
  const result = specialist.result;
  if (result?.kind === "missing") return <PublicNotFound />;
  if (result?.kind === "ready") return <PublicSpecialist specialist={result.data} />;
  return (
    <BookingScreen>
      <BookingLoadState error={result?.kind} retry={specialist.retry} />
    </BookingScreen>
  );
}
