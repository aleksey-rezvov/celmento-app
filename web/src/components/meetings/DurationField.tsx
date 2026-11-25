"use client";

import { useId, type ReactElement } from "react";
import { ChoiceChips } from "@/components/shell/ChoiceChips";
import { useTranslation, type MessageKey } from "@/lib/i18n";

const options = [15, 30, 45, 60, 75, 90] as const;

export function minutes(value: string): number | null {
  if (!/^[0-9]+$/u.test(value)) return null;
  const amount = Number(value);
  return Number.isSafeInteger(amount) && amount > 0 && amount <= 2_147_483_647 ? amount : null;
}

interface DurationFieldProps {
  label: MessageKey;
  value: string;
  onChange: (value: string) => void;
  end?: string | null;
}

export function DurationField({ label, value, onChange, end }: DurationFieldProps): ReactElement {
  const t = useTranslation();
  const input = useId();
  return (
    <div className="meeting-field meeting-duration">
      <label htmlFor={input}>{t(label)}</label>
      <ChoiceChips
        label={t(label)}
        options={options.map((duration) => ({
          value: duration,
          label: t("public.duration", { N: duration }),
        }))}
        value={minutes(value)}
        onChange={(duration) => onChange(String(duration))}
      />
      <input
        id={input}
        type="text"
        inputMode="numeric"
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
      {end && <p className="meeting-hint">{end}</p>}
    </div>
  );
}
