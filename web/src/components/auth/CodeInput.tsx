"use client";

import type { ReactElement } from "react";
import { useTranslation } from "@/lib/i18n";

interface CodeInputProps {
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  invalid: boolean;
}

export function CodeInput({ value, onChange, disabled, invalid }: CodeInputProps): ReactElement {
  const t = useTranslation();

  // spec:impl email-code-sign-in#support-one-time-code-autofill-email
  return (
    <input
      className="auth-code-input"
      value={value}
      type="text"
      inputMode="numeric"
      autoComplete="one-time-code"
      spellCheck={false}
      aria-label={t("extra.auth_code_input")}
      aria-describedby={invalid ? "auth-code-error" : undefined}
      aria-invalid={invalid}
      disabled={disabled}
      onChange={(event) => onChange(event.currentTarget.value.replace(/\D/gu, "").slice(0, 6))}
    />
  );
}
