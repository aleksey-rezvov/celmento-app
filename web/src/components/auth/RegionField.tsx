"use client";

import { useId, type ReactElement } from "react";
import type { Contour } from "@/lib/contour";
import { useTranslation } from "@/lib/i18n";

interface RegionFieldProps {
  value: Contour;
  onChange: (value: Contour) => void;
  locked: boolean;
  disabled?: boolean;
}

export function RegionField({ value, onChange, locked, disabled }: RegionFieldProps): ReactElement {
  const id = useId();
  const hint = id + "-hint";
  const t = useTranslation();

  // spec:impl region-contours#show-region-field-region-screen
  // spec:impl region-contours#show-region-field-hint-selected
  return (
    <div className="auth-field-with-hint">
      <label className="auth-field" htmlFor={id}>
        <span>{t("finish.region")}</span>
        <select
          id={id}
          value={value}
          aria-describedby={hint}
          disabled={disabled || locked}
          onChange={(event) => onChange(event.currentTarget.value === "ru" ? "ru" : "world")}
        >
          <option value="ru">{t("finish.region_ru")}</option>
          <option value="world">{t("finish.region_world")}</option>
        </select>
      </label>
      <div id={hint} className="auth-hint">
        {locked && <p>{t("finish.region_locked")}</p>}
        <p>{t(value === "ru" ? "finish.region_hint_ru" : "finish.region_hint_world")}</p>
        <p>{t("finish.region_warning")}</p>
      </div>
    </div>
  );
}
