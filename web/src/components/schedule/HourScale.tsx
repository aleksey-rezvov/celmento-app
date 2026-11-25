"use client";

import type { ReactElement } from "react";
import { useTranslation } from "@/lib/i18n";

export const hours = Array.from({ length: 24 }, (_, hour) => `${String(hour).padStart(2, "0")}:00`);

interface HourScaleProps {
  available: ReadonlyMap<number, string>;
  selected: number | null;
  onSelect: (hour: number) => void;
}

export function HourScale({ available, selected, onSelect }: HourScaleProps): ReactElement {
  const t = useTranslation();

  return (
    <div className="schedule-hour-scale">
      {hours.map((label, hour) =>
        available.has(hour) ? (
          <button
            type="button"
            aria-pressed={selected === hour}
            aria-label={`${t("form.start")} ${label}`}
            key={label}
            onClick={() => onSelect(hour)}
          >
            <span>{label}</span>
          </button>
        ) : (
          <div key={label}>
            <span>{label}</span>
          </div>
        ),
      )}
    </div>
  );
}
