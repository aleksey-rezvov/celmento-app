"use client";

import { useId, type ReactElement } from "react";
import type { Schemas } from "@/lib/api/client";
import { loginHint } from "@/lib/auth";
import { useTranslation, type MessageKey } from "@/lib/i18n";

interface LoginFieldProps {
  value: string;
  onChange: (value: string) => void;
  status: Schemas["LoginAvailabilityStatus"] | null;
  domainPrefix: string;
  labelKey: MessageKey;
  hintKey: MessageKey;
  disabled?: boolean;
}

export function LoginField({
  value,
  onChange,
  status,
  domainPrefix,
  labelKey,
  hintKey,
  disabled,
}: LoginFieldProps): ReactElement {
  const t = useTranslation();
  const id = useId();
  const label = id + "-label";
  const prefix = id + "-prefix";
  const hint = id + "-hint";
  const fail = id + "-error";
  const available = id + "-available";
  const message = loginHint(status);
  const description =
    prefix +
    " " +
    hint +
    (message ? " " + fail : "") +
    (status === "available" ? " " + available : "");

  return (
    <div className="auth-field-with-hint">
      <label className="auth-field" htmlFor={id}>
        <span id={label}>{t(labelKey)}</span>
        <span className="auth-address-input">
          <span id={prefix} className="auth-domain-prefix">
            {domainPrefix}
          </span>
          <input
            id={id}
            value={value}
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            aria-invalid={message !== null}
            aria-labelledby={label}
            aria-describedby={description}
            disabled={disabled}
            onChange={(event) => onChange(event.currentTarget.value)}
          />
          {status === "available" && (
            <span
              id={available}
              className="auth-login-available"
              role="img"
              aria-label={t("extra.auth_login_available")}
            >
              ✓
            </span>
          )}
        </span>
      </label>
      <p className="auth-hint" id={hint}>
        {t(hintKey)}
      </p>
      {message && (
        <p id={fail} className="auth-error" role="status">
          {t(message)}
        </p>
      )}
    </div>
  );
}
