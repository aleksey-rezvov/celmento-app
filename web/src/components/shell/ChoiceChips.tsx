"use client";

import type { ReactElement, ReactNode } from "react";

interface Choice<Value extends string | number> {
  value: Value;
  label: ReactNode;
  disabled?: boolean;
}

interface ChoiceChipsProps<Value extends string | number> {
  options: readonly Choice<Value>[];
  value: Value | null;
  onChange: (value: Value) => void;
  label?: string;
}

export function ChoiceChips<Value extends string | number>({
  options,
  value,
  onChange,
  label,
}: ChoiceChipsProps<Value>): ReactElement {
  return (
    <div className="shell-chips" role={label ? "group" : undefined} aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className="shell-chip"
          aria-pressed={option.value === value}
          disabled={option.disabled}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
