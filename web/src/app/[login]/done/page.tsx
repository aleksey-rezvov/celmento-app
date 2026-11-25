"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactElement } from "react";
import { BookingScreen } from "@/components/booking/BookingScreen";
import { useBookingSession } from "@/components/booking/BookingSession";
import { CalendarButton } from "@/components/booking/CalendarButton";
import { ZoneLabel } from "@/components/booking/ZoneLabel";
import { bookingFormatLabels } from "@/components/booking/booking-display";
import { callHref, publicBookingPath } from "@/components/booking/booking-paths";
import { apiClient } from "@/lib/api/client";
import { deviceTimeZone } from "@/lib/device";
import { formatDate, formatTime } from "@/lib/format";
import { useLanguage, useTranslation } from "@/lib/i18n";
import { prepareSignInHandoff } from "@/lib/registration";

export default function BookingDonePage(): ReactElement {
  const { login, state } = useBookingSession();
  const router = useRouter();
  const t = useTranslation();
  const language = useLanguage();
  const timeZone = deviceTimeZone();
  const [authError, setAuthError] = useState(false);
  const confirmation = state.outcome?.kind === "booked" ? state.outcome.confirmation : null;

  useEffect(() => {
    if (!confirmation) router.replace(publicBookingPath(login));
  }, [confirmation, login, router]);

  if (!confirmation)
    return (
      <BookingScreen>
        <div aria-busy="true" />
      </BookingScreen>
    );

  const { id, email, starts_at, place, meeting_link, specialist_name } = confirmation;
  const call = place === "online" ? callHref(meeting_link) : null;

  function openApp(): void {
    try {
      prepareSignInHandoff({ email, origin: { page: "public_booking", login, meeting_id: null } });
      // spec:impl guest-booking-flow#open-sign-in-leader-contour-domain
      // spec:impl registration-intent-screen#show-screen-1-0-person-arrives
      router.push("/login");
    } catch {
      setAuthError(true);
    }
  }

  return (
    <BookingScreen illustration="booking_done">
      <section className="booking-card booking-centered">
        <h1>{t("done.title")}</h1>
        <div className="booking-details">
          <p className="booking-name">{specialist_name}</p>
          <time dateTime={starts_at}>
            {formatDate(starts_at, timeZone, language)} ·{" "}
            {formatTime(starts_at, timeZone, language)}
          </time>
          <ZoneLabel timeZone={timeZone} at={new Date(starts_at)} />
          <p>{t(bookingFormatLabels[place])}</p>
        </div>
        <div className="booking-actions">
          {call && (
            <a className="auth-secondary" href={call} target="_blank" rel="noreferrer">
              {t("meet.join")}
            </a>
          )}
          {/* spec:impl guest-booking-flow#offer-save-device-calendar-event */}
          <CalendarButton
            label="done.add_calendar"
            load={(signal) =>
              apiClient(null).GET("/public/bookings/{booking_id}/calendar.ics", {
                params: { path: { booking_id: id } },
                parseAs: "blob",
                signal,
                cache: "no-store",
              })
            }
          />
          <button className="auth-primary" type="button" onClick={openApp}>
            {t("done.open_app")}
          </button>
          {authError && (
            <p className="auth-error" role="alert">
              {t("extra.auth_request_failed")}
            </p>
          )}
        </div>
      </section>
    </BookingScreen>
  );
}
