"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactElement } from "react";
import {
  ConsentCheckbox,
  personalDataDocuments,
  termsDocuments,
} from "@/components/auth/ConsentCheckbox";
import { BookingForm } from "@/components/booking/BookingForm";
import {
  BookingLoadState,
  BookingScreen,
  PublicNotFound,
} from "@/components/booking/BookingScreen";
import {
  emptyBookingDraft,
  useBookingSession,
  type BookingFormValues,
} from "@/components/booking/BookingSession";
import { publicBookingPath } from "@/components/booking/booking-paths";
import { usePublicSpecialist } from "@/components/booking/public-resource";
import { DocumentOverlay } from "@/components/DocumentOverlay";
import { apiClient, errorCode, type Schemas } from "@/lib/api/client";
import { normalizeEmail } from "@/lib/auth";
import { currentContour } from "@/lib/contour";
import { deviceTimeZone } from "@/lib/device";
import { useLanguage, useTranslation, type MessageKey } from "@/lib/i18n";
import { documentAcceptances, signupKinds, useLegalDocuments } from "@/lib/legal-documents";

function GuestBooking({
  specialist: initialSpecialist,
  startsAt,
  bookingContext,
}: {
  specialist: Schemas["PublicSpecialistPage"];
  startsAt: string;
  bookingContext: string;
}): ReactElement {
  const router = useRouter();
  const [specialist, setSpecialist] = useState(initialSpecialist);
  const { state, update, idempotency } = useBookingSession();
  const language = useLanguage();
  const t = useTranslation();
  const contour = currentContour();
  const timeZone = deviceTimeZone();
  const legal = useLegalDocuments(signupKinds, contour, language);
  const [openDocument, setOpenDocument] = useState<Schemas["LegalDocumentKind"] | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  const [missing, setMissing] = useState(false);
  const pending = useRef<AbortController | null>(null);
  const terms = legal.documents.find(({ kind }) => kind === "terms_of_use");
  const privacy = legal.documents.find(({ kind }) => kind === "personal_data_consent");
  const { draft } = state;
  const termsChecked = terms !== undefined && draft.termsVersion === terms.version;
  const privacyChecked = privacy !== undefined && draft.privacyVersion === privacy.version;
  const back = publicBookingPath(specialist.login);

  useEffect(() => () => pending.current?.abort(), []);

  async function submit(values: BookingFormValues): Promise<void> {
    if (pending.current || !termsChecked || !privacyChecked) return;
    const consents = documentAcceptances(legal.documents, signupKinds);
    if (!consents) return;
    const body: Schemas["GuestBookingCreate"] = {
      login: specialist.login,
      booking_context: bookingContext,
      starts_at: startsAt,
      expected_session_format: specialist.session_format,
      name: values.name.trim(),
      email: normalizeEmail(values.email),
      contact: values.contact.trim() || null,
      comment: values.comment.trim() ? values.comment : null,
      place: specialist.session_format === "both" ? values.place : undefined,
      consents,
      language,
      time_zone: timeZone,
    };
    const controller = new AbortController();
    pending.current = controller;
    setSubmitting(true);
    setError(null);
    try {
      const api = apiClient(null);
      const {
        data,
        error: failure,
        response,
      } = await api.POST("/public/bookings", {
        body,
        params: { header: { "Idempotency-Key": idempotency.keyFor(body) } },
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (data) {
        idempotency.clear();
        update({ draft: emptyBookingDraft, outcome: { kind: "booked", confirmation: data } });
        return;
      }
      if (response.status === 404) {
        setMissing(true);
        return;
      }
      switch (errorCode(failure)) {
        case "conflict": {
          const latest = await api.GET("/public/specialists/{login}", {
            params: { path: { login: specialist.login } },
            signal: controller.signal,
            cache: "no-store",
          });
          if (controller.signal.aborted) return;
          if (
            latest.response.status === 404 ||
            (latest.data && latest.data.booking_context !== bookingContext)
          ) {
            idempotency.clear();
            update({ draft: emptyBookingDraft, outcome: null });
          } else if (latest.data && latest.data.session_format !== specialist.session_format) {
            idempotency.clear();
            setSpecialist(latest.data);
            update((previous) => ({
              ...previous,
              draft: { ...previous.draft, values: { ...previous.draft.values, place: null } },
            }));
          } else {
            setError("extra.auth_request_failed");
          }
          break;
        }
        case "slot_taken":
        case "slot_invalid":
          idempotency.clear();
          update((previous) => ({ ...previous, outcome: { kind: "slot_taken" } }));
          // spec:impl guest-booking-flow#re-check-book-slot-free-taken
          router.replace(back);
          break;
        case "booking_unavailable":
          idempotency.clear();
          update((previous) => ({ ...previous, outcome: { kind: "unavailable" } }));
          router.replace(back + "/unavailable");
          break;
        case "self_booking":
          // spec:impl guest-booking-flow#refuse-booking-self-booking-entered
          setError("c.self_booking");
          break;
        case "consent_required":
          update((previous) => ({
            ...previous,
            draft: { ...previous.draft, termsVersion: null, privacyVersion: null },
          }));
          legal.refresh();
          setError("extra.auth_request_failed");
          break;
        case "email_invalid":
          setError("extra.auth_email_invalid");
          break;
        default:
          setError("extra.auth_request_failed");
      }
    } catch {
      if (!controller.signal.aborted) setError("extra.auth_network_error");
    } finally {
      if (!controller.signal.aborted) setSubmitting(false);
      pending.current = null;
    }
  }

  if (missing) return <PublicNotFound />;

  return (
    <BookingScreen>
      <BookingForm
        mode="guest"
        startsAt={startsAt}
        timeZone={timeZone}
        format={specialist.session_format}
        changeTime={back}
        values={draft.values}
        onChange={(values) => {
          update((previous) => ({ ...previous, draft: { ...previous.draft, values } }));
          setError(null);
        }}
        onSubmit={submit}
        submitting={submitting}
        error={error}
        legalReady={termsChecked && privacyChecked}
        consent={
          <div className="auth-consents">
            {/* spec:impl guest-booking-flow#show-two-separate-unchecked-consent */}
            <ConsentCheckbox
              labelKey="signup.terms"
              documents={termsDocuments}
              checked={termsChecked}
              disabled={!terms}
              onChange={(checked) =>
                update((previous) => ({
                  ...previous,
                  draft: {
                    ...previous.draft,
                    termsVersion: checked ? (terms?.version ?? null) : null,
                  },
                }))
              }
              onDocument={setOpenDocument}
            />
            <ConsentCheckbox
              labelKey="signup.privacy"
              documents={personalDataDocuments}
              checked={privacyChecked}
              disabled={!privacy}
              onChange={(checked) =>
                update((previous) => ({
                  ...previous,
                  draft: {
                    ...previous.draft,
                    privacyVersion: checked ? (privacy?.version ?? null) : null,
                  },
                }))
              }
              onDocument={setOpenDocument}
            />
            {/* spec:impl legal-documents#make-privacy-policy-reachable-text */}
            <button
              className="auth-text-link booking-privacy-link"
              type="button"
              onClick={() => setOpenDocument("privacy_policy")}
            >
              {t("profile.privacy")}
            </button>
            {legal.failed && (
              <p role="alert" className="auth-error">
                {t("extra.auth_request_failed")}{" "}
                <button className="auth-text-link" type="button" onClick={legal.refresh}>
                  {t("extra.auth_retry")}
                </button>
              </p>
            )}
          </div>
        }
      />
      {openDocument && (
        <DocumentOverlay
          kind={openDocument}
          contour={contour}
          documents={legal.documents}
          onClose={() => setOpenDocument(null)}
        />
      )}
    </BookingScreen>
  );
}

export default function GuestBookingPage(): ReactElement {
  const { login, state, update, idempotency } = useBookingSession();
  const router = useRouter();
  const specialist = usePublicSpecialist(login);
  const { startsAt, bookingContext } = state.draft;
  const result = specialist.result;
  const booked = state.outcome?.kind === "booked";
  const stale =
    startsAt !== null && result?.kind === "ready" && bookingContext !== result.data.booking_context;

  useEffect(() => {
    if (booked) {
      // spec:impl guest-booking-flow#open-screen-9-3-after-successful
      router.replace(publicBookingPath(login) + "/done");
    } else if (stale) {
      idempotency.clear();
      update({ draft: emptyBookingDraft, outcome: null });
    } else if (!startsAt) {
      router.replace(publicBookingPath(login));
    }
  }, [booked, idempotency, login, router, stale, startsAt, update]);

  if (result?.kind === "missing") return <PublicNotFound />;
  if (result?.kind === "ready" && startsAt && bookingContext && !stale && !booked) {
    return (
      <GuestBooking
        key={startsAt}
        specialist={result.data}
        startsAt={startsAt}
        bookingContext={bookingContext}
      />
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
