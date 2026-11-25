"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactElement } from "react";
import { AuthCard } from "@/components/auth/AuthCard";
import { CodeInput } from "@/components/auth/CodeInput";
import { apiClient, errorCode } from "@/lib/api/client";
import { codeCooldown, codeLockout, retryAfterSeconds } from "@/lib/auth";
import { useLanguage, useTranslation, type MessageKey } from "@/lib/i18n";
import {
  clearRegistration,
  closeCode,
  loadOpenCode,
  resumePath,
  saveCode,
  saveEmail,
  savePackage,
  saveSignupEmail,
  startCode,
  type PendingCode,
} from "@/lib/registration";
import { clearRegistrationDeviceKey, createRegistrationDeviceKey } from "@/lib/registration-device";
import { setSessionToken } from "@/lib/session";

interface CodeFormProps {
  initialCode: PendingCode;
}

function CodeForm({ initialCode }: CodeFormProps): ReactElement {
  const router = useRouter();
  const t = useTranslation();
  const language = useLanguage();
  const [challenge, setChallenge] = useState(initialCode);
  const [code, setCode] = useState("");
  const [time, setTime] = useState(Date.now);
  const [message, setMessage] = useState<MessageKey | null>(null);
  const [busy, setBusy] = useState(false);

  const locked = challenge.lockedUntil > time;
  const expired = challenge.expiresAt <= time;
  const invalid = message === "code.error";
  const retryAt = Math.max(challenge.resendAt, challenge.lockedUntil);
  const retryIn = Math.max(0, Math.ceil((retryAt - time) / 1000));
  const notice = locked ? "code.locked" : expired ? "code.expired" : message;

  useEffect(() => {
    const timer = window.setInterval(() => setTime(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, []);

  function changeEmail(): void {
    // spec:impl email-code-sign-in#return-screen-1-1-email-prefilled
    saveEmail(challenge.email);
    closeCode();
    router.replace("/login");
  }

  function updateChallenge(next: PendingCode): void {
    saveCode(next);
    setChallenge(next);
    setTime(Date.now());
  }

  async function verify(next: string): Promise<void> {
    setCode(next);
    setMessage(null);
    // spec:impl email-code-sign-in#accept-only-digits-code-field
    if (next.length !== 6 || busy || locked || expired) {
      return;
    }

    setBusy(true);
    let devicePublicKey: string | undefined;
    let hasPackage = false;
    try {
      if (challenge.registration) {
        try {
          devicePublicKey = await createRegistrationDeviceKey();
        } catch {
          setCode("");
          setMessage("extra.auth_request_failed");
          return;
        }
      }

      const { data, error } = await apiClient(null).POST("/auth/code/verify", {
        body: {
          email: challenge.email,
          code: next,
          registration: challenge.registration,
          registration_device_key: devicePublicKey,
        },
      });

      if (data?.outcome === "signed_in" && data.session) {
        clearRegistration();
        setSessionToken(data.session.token);
        router.replace("/app");
        return;
      }

      if (
        data?.outcome === "registration_confirmed" &&
        data.registration_package &&
        devicePublicKey &&
        data.registration_package.claims.device_public_key === devicePublicKey
      ) {
        savePackage(data.registration_package);
        hasPackage = true;
        // spec:impl email-code-sign-in#confirm-registration-code
        router.replace("/register/finish");
        return;
      }

      switch (errorCode(error)) {
        case "code_invalid":
          // spec:impl email-code-sign-in#keep-person-screen-1-3-after
          setMessage("code.error");
          break;
        case "code_expired":
          updateChallenge({ ...challenge, expiresAt: Date.now() });
          break;
        case "code_locked":
          updateChallenge({
            ...challenge,
            lockedUntil: Date.now() + retryAfterSeconds(error, codeLockout) * 1000,
          });
          break;
        case "registration_required":
          saveSignupEmail(challenge.email);
          closeCode();
          router.replace("/register");
          break;
        default:
          setMessage("extra.auth_request_failed");
      }
    } catch {
      setMessage("extra.auth_network_error");
    } finally {
      if (devicePublicKey && !hasPackage) {
        void clearRegistrationDeviceKey(devicePublicKey);
      }
      setBusy(false);
    }
  }

  async function resend(): Promise<void> {
    if (busy || retryIn > 0) {
      return;
    }

    setBusy(true);
    setMessage(null);
    try {
      const api = apiClient(null);
      const { data, error } = challenge.registration
        ? await api.POST("/auth/register", { body: { ...challenge.registration, language } })
        : await api.POST("/auth/code/request", { body: { email: challenge.email, language } });

      if (data) {
        if ("outcome" in data && data.outcome === "registration_required") {
          saveSignupEmail(challenge.email);
          closeCode();
          router.replace("/register");
          return;
        }

        const registration =
          "account_exists" in data && !data.account_exists ? challenge.registration : undefined;
        setChallenge(startCode(challenge.email, data.first_name, registration));
        setCode("");
        setTime(Date.now());
        return;
      }

      switch (errorCode(error)) {
        case "resend_too_soon":
          updateChallenge({
            ...challenge,
            resendAt: Date.now() + retryAfterSeconds(error, codeCooldown) * 1000,
          });
          break;
        case "code_locked":
          updateChallenge({
            ...challenge,
            lockedUntil: Date.now() + retryAfterSeconds(error, codeLockout) * 1000,
          });
          break;
        default:
          setMessage("extra.auth_request_failed");
      }
    } catch {
      setMessage("extra.auth_network_error");
    } finally {
      setBusy(false);
    }
  }

  const title = challenge.firstName
    ? t("code.title_known", { name: challenge.firstName, имя: challenge.firstName })
    : t("code.title_new");
  const subtitle = t("code.subtitle", { email: challenge.email, почта: challenge.email });

  return (
    <AuthCard
      title={title}
      subtitle={subtitle}
      illustration={invalid || locked ? "code_error" : "code"}
    >
      <div className="auth-form">
        <CodeInput
          value={code}
          onChange={(next) => void verify(next)}
          disabled={locked || expired || busy}
          invalid={invalid}
        />
        {notice && (
          <p id="auth-code-error" className="auth-error" role="alert">
            {t(notice)}
          </p>
        )}
        {/* spec:impl email-code-sign-in#show-hint-spam-screen-1-3 */}
        <p className="auth-hint">{t("code.hint_spam")}</p>
        {/* spec:impl email-code-sign-in#show-expired-send-code-button-entered */}
        <button
          className="auth-text-link auth-resend"
          type="button"
          disabled={busy || retryIn > 0}
          onClick={() => void resend()}
        >
          {retryIn > 0
            ? t("code.resend_timer", { sec: retryIn, сек: retryIn })
            : t(expired ? "extra.auth_send_code" : "code.resend")}
        </button>
        <div className="auth-actions auth-code-actions">
          <button
            className="auth-icon auth-icon-secondary"
            type="button"
            aria-label={t("code.change_email")}
            disabled={busy}
            onClick={changeEmail}
          >
            <span aria-hidden="true">←</span>
          </button>
          <button className="auth-secondary" type="button" disabled={busy} onClick={changeEmail}>
            {t("code.change_email")}
          </button>
        </div>
      </div>
    </AuthCard>
  );
}

export default function Code(): ReactElement | null {
  const router = useRouter();
  const [challenge] = useState(loadOpenCode);
  const [next] = useState(resumePath);
  const redirect =
    next === "/app" || next === "/register/finish" ? next : challenge === null ? "/login" : null;

  useEffect(() => {
    if (redirect) {
      router.replace(redirect);
    }
  }, [redirect, router]);

  return redirect || challenge === null ? null : <CodeForm initialCode={challenge} />;
}
