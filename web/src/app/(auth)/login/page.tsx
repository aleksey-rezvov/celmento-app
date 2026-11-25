"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useState, type FormEvent, type ReactElement } from "react";
import { AuthCard } from "@/components/auth/AuthCard";
import { apiClient, errorCode } from "@/lib/api/client";
import { codeCooldown, normalizeEmail, retryAfterSeconds, validEmail } from "@/lib/auth";
import { useLanguage, useTranslation, type MessageKey } from "@/lib/i18n";
import {
  loadEmail,
  parseRegistrationOrigin,
  prepareSignInHandoff,
  resumeCode,
  resumePath,
  saveCode,
  saveEmail,
  saveSignupEmail,
  startCode,
  type SignInHandoff,
} from "@/lib/registration";

function readLink(): SignInHandoff | null {
  const url = new URL(window.location.href);
  const rawEmail = url.searchParams.get("email");
  const email = rawEmail && validEmail(rawEmail) ? normalizeEmail(rawEmail) : null;
  const origin = parseRegistrationOrigin(url.searchParams.get("origin"));
  return email || origin ? { email, origin } : null;
}

export default function Login(): ReactElement | null {
  const router = useRouter();
  const t = useTranslation();
  const language = useLanguage();
  const input = useId();
  const hint = input + "-hint";
  const [link] = useState(readLink);
  const [next] = useState(() => resumePath(link ?? undefined));
  const [email, setEmail] = useState(() => link?.email ?? loadEmail());
  const [error, setError] = useState<MessageKey | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const valid = validEmail(email);
  const showInvalid = (email !== "" && !valid) || error === "extra.auth_email_invalid";

  useEffect(() => {
    if (link) prepareSignInHandoff(link);

    const url = new URL(window.location.href);
    url.searchParams.delete("email");
    url.searchParams.delete("origin");
    if (url.href !== window.location.href) {
      window.history.replaceState(window.history.state, "", url.pathname + url.search);
    }
    if (next && next !== "/login") router.replace(next);
  }, [link, next, router]);

  async function sendCode(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!valid || submitting) {
      return;
    }

    const address = normalizeEmail(email);
    saveEmail(address);

    if (resumeCode(address)) {
      router.push("/login/code");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const { data, error: failure } = await apiClient(null).POST("/auth/code/request", {
        body: { email: address, language },
      });

      if (data?.outcome === "registration_required") {
        // spec:impl email-code-sign-in#route-unknown-email-to-registration
        saveSignupEmail(address);
        router.push("/register");
        return;
      }

      if (data?.outcome === "code_sent") {
        startCode(address, data.first_name);
        router.push("/login/code");
        return;
      }

      switch (errorCode(failure)) {
        case "email_invalid":
          setError("extra.auth_email_invalid");
          break;
        case "resend_too_soon": {
          const code = startCode(address, null);
          saveCode({
            ...code,
            resendAt: Date.now() + retryAfterSeconds(failure, codeCooldown) * 1000,
          });
          router.push("/login/code");
          break;
        }
        case "code_locked":
          setError("code.locked");
          break;
        default:
          setError("extra.auth_request_failed");
      }
    } catch {
      // spec:impl email-code-sign-in#show-keep-entered-data-code
      setError("extra.auth_network_error");
    } finally {
      setSubmitting(false);
    }
  }

  if (next && next !== "/login") {
    return null;
  }

  // spec:impl email-code-sign-in#show-email-entry
  // spec:impl email-code-sign-in#show-celmento-login-blue-left
  // spec:impl character-illustrations#build-sign-in-screen-1-1-two
  return (
    <AuthCard
      title={t("login.title")}
      subtitle={t("login.subtitle")}
      illustration="login_pair"
      intro={
        <div className="auth-brand">
          <span className="auth-wordmark">celmēnto</span>
          <p>{t("login.tagline")}</p>
        </div>
      }
    >
      <form className="auth-form" noValidate onSubmit={(event) => void sendCode(event)}>
        <div className="auth-email-row">
          <input
            id={input}
            className="auth-email-input"
            type="email"
            autoComplete="email"
            inputMode="email"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={254}
            value={email}
            disabled={submitting}
            placeholder={t("login.email")}
            aria-label={t("login.email")}
            aria-invalid={showInvalid}
            aria-describedby={showInvalid ? hint : undefined}
            onChange={(event) => {
              setEmail(event.currentTarget.value);
              setError(null);
            }}
          />
          {/* spec:impl email-code-sign-in#require-valid-email */}
          <button
            className="auth-icon auth-primary"
            type="submit"
            disabled={!valid || submitting}
            aria-label={t("login.title")}
          >
            <span aria-hidden="true">→</span>
          </button>
        </div>
        {showInvalid && (
          <p id={hint} className="auth-error" role="status">
            {t("extra.auth_email_invalid")}
          </p>
        )}
        {error && error !== "extra.auth_email_invalid" && (
          <p className="auth-error" role="alert">
            {t(error)}
          </p>
        )}
      </form>
    </AuthCard>
  );
}
