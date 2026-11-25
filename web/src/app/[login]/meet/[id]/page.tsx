"use client";

import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactElement } from "react";
import {
  BookingLoadState,
  BookingScreen,
  PublicNotFound,
} from "@/components/booking/BookingScreen";
import { useBookingSession } from "@/components/booking/BookingSession";
import { CalendarButton } from "@/components/booking/CalendarButton";
import { LeaderHeader } from "@/components/booking/LeaderHeader";
import { ZoneLabel } from "@/components/booking/ZoneLabel";
import { bookingFormatLabels } from "@/components/booking/booking-display";
import { callHref } from "@/components/booking/booking-paths";
import { usePublicResource } from "@/components/booking/public-resource";
import { apiClient, errorCode, type Schemas } from "@/lib/api/client";
import { codeCooldown, normalizeEmail, retryAfterSeconds, validEmail } from "@/lib/auth";
import { deviceTimeZone } from "@/lib/device";
import { formatDate, formatTime } from "@/lib/format";
import { useLanguage, useTranslation, type MessageKey } from "@/lib/i18n";
import {
  loadCode,
  loadPackage,
  prepareSignInHandoff,
  resumeCode,
  saveCode,
  saveSignupEmail,
  startCode,
} from "@/lib/registration";

interface MeetingInviteProps {
  invite: Schemas["MeetingInvitePage"];
  login: string;
  meetingId: string;
}

function MeetingInvite({ invite, login, meetingId }: MeetingInviteProps): ReactElement {
  const router = useRouter();
  const language = useLanguage();
  const t = useTranslation();
  const timeZone = deviceTimeZone();
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  const [missing, setMissing] = useState(false);
  const pending = useRef<AbortController | null>(null);
  const valid = validEmail(email);
  const name = [invite.specialist_first_name, invite.specialist_last_name]
    .filter(Boolean)
    .join(" ");
  const call = callHref(invite.meeting_link);
  const params = { path: { login, meeting_id: meetingId } };

  useEffect(() => () => pending.current?.abort(), []);

  function origin(): Schemas["RegistrationOrigin"] {
    return { page: "meeting_invite", login, meeting_id: meetingId };
  }

  async function join(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!valid || pending.current) return;

    const address = normalizeEmail(email);
    const controller = new AbortController();
    pending.current = controller;
    setSubmitting(true);
    setError(null);
    try {
      const {
        data,
        error: failure,
        response,
      } = await apiClient(null).POST("/public/specialists/{login}/meet/{meeting_id}/join", {
        params,
        body: { email: address, language },
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (data) {
        prepareSignInHandoff({ email: address, origin: origin() });
        // spec:impl meeting-invite-page#start-sign-in-registration-entered-email
        if (data.outcome === "registration_required") {
          if (!loadPackage() && resumeCode(address)) {
            router.push("/login/code");
          } else {
            saveSignupEmail(address);
            router.push("/register");
          }
        } else {
          startCode(address, data.first_name);
          router.push("/login/code");
        }
        return;
      }
      if (response.status === 404 || response.status === 422) {
        setMissing(true);
        return;
      }
      switch (errorCode(failure)) {
        case "resend_too_soon": {
          prepareSignInHandoff({ email: address, origin: origin() });
          const current = resumeCode(address) ? loadCode() : null;
          const code = current ?? startCode(address, null);
          saveCode({
            ...code,
            resendAt: Date.now() + retryAfterSeconds(failure, codeCooldown) * 1000,
          });
          router.push("/login/code");
          break;
        }
        case "email_invalid":
          setError("extra.auth_email_invalid");
          break;
        case "code_locked":
          setError("code.locked");
          break;
        default:
          setError("extra.auth_request_failed");
      }
    } catch {
      if (!controller.signal.aborted) setError("extra.auth_network_error");
    } finally {
      pending.current = null;
      if (!controller.signal.aborted) setSubmitting(false);
    }
  }

  if (missing) return <PublicNotFound meeting />;

  // spec:impl meeting-invite-page#open-screen-9-11-domain-login
  // spec:impl meeting-invite-page#show-page-client-name-card
  return (
    <BookingScreen illustration="meeting_invite">
      <section className="booking-card booking-profile-card booking-centered">
        {/* spec:impl meeting-invite-page#show-character-title-leader-name */}
        <LeaderHeader
          firstName={invite.specialist_first_name}
          lastName={invite.specialist_last_name}
          photoUrl={invite.photo_url}
          specializations={invite.specializations}
          specializationOther={invite.specialization_other}
          title={t("meet.title", { name, имя: name })}
        />
        <div className="booking-details">
          <time dateTime={invite.starts_at}>
            {formatDate(invite.starts_at, timeZone, language)} ·{" "}
            {formatTime(invite.starts_at, timeZone, language)}
          </time>
          <ZoneLabel timeZone={timeZone} at={new Date(invite.starts_at)} />
          <p>
            {t("public.duration", { N: invite.duration_minutes })} ·{" "}
            {t(bookingFormatLabels[invite.place])}
          </p>
          {/* spec:impl meeting-invite-page#show-in-person-meeting-address */}
          {invite.place === "in_person" && invite.address && (
            <p>
              <span className="booking-hint">{t("form.address")}</span> · {invite.address}
            </p>
          )}
        </div>
        <div className="booking-actions">
          {/* spec:impl meeting-invite-page#show-join-opening-meeting-call */}
          {call && (
            <a className="auth-primary" href={call} target="_blank" rel="noreferrer">
              {t("meet.join")}
            </a>
          )}
          {/* spec:impl meeting-invite-page#show-add-calendar-offering-save-device */}
          <CalendarButton
            label="meet.add_calendar"
            load={(signal) =>
              apiClient(null).GET("/public/specialists/{login}/meet/{meeting_id}/calendar.ics", {
                params: { ...params, query: { language } },
                parseAs: "blob",
                signal,
                cache: "no-store",
              })
            }
            onMissing={() => setMissing(true)}
          />
        </div>
      </section>
      {/* spec:impl meeting-invite-page#show-block-signup-title-signup-hint */}
      {/* spec:impl meeting-invite-page#write-anything-database-page-opened */}
      <section className="booking-card">
        <h2>{t("meet.signup_title")}</h2>
        <p className="booking-hint">{t("meet.signup_hint")}</p>
        <form className="auth-form" noValidate onSubmit={(event) => void join(event)}>
          <div className="auth-email-row">
            <input
              className="auth-email-input"
              type="email"
              value={email}
              maxLength={254}
              autoComplete="email"
              inputMode="email"
              autoCapitalize="none"
              spellCheck={false}
              aria-label={t("form.email")}
              placeholder={t("form.email")}
              disabled={submitting}
              onChange={(event) => {
                setEmail(event.currentTarget.value);
                setError(null);
              }}
            />
            <button
              type="submit"
              className="auth-primary auth-icon"
              aria-label={t("meet.signup_button")}
              disabled={!valid || submitting}
            >
              <span aria-hidden="true">→</span>
            </button>
          </div>
          {error && (
            <p className="auth-error" role="alert">
              {t(error)}
            </p>
          )}
        </form>
      </section>
    </BookingScreen>
  );
}

export default function MeetingInvitePage(): ReactElement {
  const { id } = useParams<{ id: string }>();
  const { login } = useBookingSession();
  const load = useCallback(
    (signal: AbortSignal) =>
      apiClient(null).GET("/public/specialists/{login}/meet/{meeting_id}", {
        params: { path: { login, meeting_id: id } },
        signal,
        cache: "no-store",
      }),
    [id, login],
  );
  const invite = usePublicResource(load);
  const result = invite.result;

  if (result?.kind === "missing") return <PublicNotFound meeting />;
  if (result?.kind === "ready")
    return <MeetingInvite invite={result.data} login={login} meetingId={id} />;
  return (
    <BookingScreen>
      <BookingLoadState error={result?.kind} retry={invite.retry} />
    </BookingScreen>
  );
}
