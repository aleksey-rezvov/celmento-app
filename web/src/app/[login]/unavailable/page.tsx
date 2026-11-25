"use client";

import { useRouter } from "next/navigation";
import { useEffect, type ReactElement } from "react";
import {
  BookingLoadState,
  BookingScreen,
  PublicNotFound,
} from "@/components/booking/BookingScreen";
import { useBookingSession } from "@/components/booking/BookingSession";
import { MainContactButton } from "@/components/booking/MainContactButton";
import { publicBookingPath } from "@/components/booking/booking-paths";
import { usePublicSpecialist } from "@/components/booking/public-resource";
import { useTranslation } from "@/lib/i18n";

export default function BookingUnavailablePage(): ReactElement {
  const { login, state } = useBookingSession();
  const router = useRouter();
  const t = useTranslation();
  const specialist = usePublicSpecialist(login);
  const unavailable = state.outcome?.kind === "unavailable";
  const result = specialist.result;

  useEffect(() => {
    if (!unavailable) router.replace(publicBookingPath(login));
  }, [login, router, unavailable]);

  if (result?.kind === "missing") return <PublicNotFound />;
  if (result?.kind === "ready" && unavailable) {
    const { first_name, last_name, main_contact } = result.data;
    const name = [first_name, last_name].filter(Boolean).join(" ");
    // spec:impl guest-booking-flow#show-screen-9-4-character-text
    // spec:impl guest-booking-flow#show-screen-9-4-email-matches
    return (
      <BookingScreen illustration="booking_unavailable">
        <section className="booking-card booking-centered">
          <h1 className="booking-message">{t("unavailable.text", { name, имя: name })}</h1>
          <MainContactButton contact={main_contact} />
        </section>
      </BookingScreen>
    );
  }

  return (
    <BookingScreen>
      <BookingLoadState
        error={result?.kind === "error" || result?.kind === "offline" ? result.kind : undefined}
        retry={specialist.retry}
      />
    </BookingScreen>
  );
}
