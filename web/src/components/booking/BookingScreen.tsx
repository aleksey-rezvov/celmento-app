import Link from "next/link";
import type { ReactElement, ReactNode } from "react";
import { Character } from "@/components/Character";
import { useTranslation } from "@/lib/i18n";
import type { CharacterState } from "@/lib/characters";

export function BookingScreen({
  illustration,
  children,
}: {
  illustration?: CharacterState;
  children: ReactNode;
}): ReactElement {
  return (
    <main className="booking-page">
      {illustration && <Character state={illustration} size={200} />}
      {children}
    </main>
  );
}

export function BookingLoadState({
  error,
  retry,
}: {
  error?: "error" | "offline";
  retry: () => void;
}): ReactElement {
  const t = useTranslation();
  if (!error) return <div aria-busy="true" className="booking-card booking-loading" />;

  return (
    <section className="booking-card">
      <p role="alert" className="auth-error">
        {t(error === "offline" ? "extra.auth_network_error" : "extra.auth_request_failed")}
      </p>
      <button className="auth-secondary" type="button" onClick={retry}>
        {t("extra.auth_retry")}
      </button>
    </section>
  );
}

export function PublicNotFound({ meeting = false }: { meeting?: boolean }): ReactElement {
  const t = useTranslation();
  // spec:impl public-booking-page#show-not-found-page-character-link
  // spec:impl meeting-invite-page#show-not-found-page-character-link
  return (
    <BookingScreen illustration={meeting ? "meeting_not_found" : "public_not_found"}>
      <section className="booking-card booking-centered">
        <h1>{t(meeting ? "meet.not_found" : "public.not_found")}</h1>
        <Link className="auth-secondary" href="/">
          {t("extra.celmento_site")}
        </Link>
      </section>
    </BookingScreen>
  );
}
