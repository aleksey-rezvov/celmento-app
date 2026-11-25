"use client";

import type { ReactElement } from "react";
import type { Schemas } from "@/lib/api/client";
import { useLanguage, useTranslation } from "@/lib/i18n";

const weekdays: readonly Schemas["Weekday"][] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const quarterHours = Array.from({ length: 96 }, (_, index) => {
  const hours = Math.floor(index / 4)
    .toString()
    .padStart(2, "0");
  const minutes = ((index % 4) * 15).toString().padStart(2, "0");
  return hours + ":" + minutes;
});

interface WorkingHoursEditorProps {
  value: Schemas["WorkingDay"][];
  onChange: (value: Schemas["WorkingDay"][]) => void;
}

export function WorkingHoursEditor({ value, onChange }: WorkingHoursEditorProps): ReactElement {
  const t = useTranslation();
  const language = useLanguage();
  const dayNames = new Intl.DateTimeFormat(language, { weekday: "long", timeZone: "UTC" });

  function change(weekday: Schemas["Weekday"], changes: Partial<Schemas["WorkingDay"]>): void {
    onChange(value.map((day) => (day.weekday === weekday ? { ...day, ...changes } : day)));
  }

  return (
    <div className="profile-work-editor">
      <div className="profile-group">
        {/* spec:impl working-hours-booking-rules#show-screen-2-3-7-days */}
        {weekdays.map((weekday, index) => {
          const day = value.find((candidate) => candidate.weekday === weekday);
          if (!day) return null;
          const name = dayNames.format(new Date(Date.UTC(2024, 0, index + 1)));

          return (
            <fieldset key={weekday} className="profile-work-day">
              <legend>{name}</legend>
              <label className="profile-work-toggle">
                <input
                  type="checkbox"
                  role="switch"
                  aria-label={name + " · " + t("profile.work_day")}
                  checked={day.working}
                  onChange={(event) => change(weekday, { working: event.currentTarget.checked })}
                />
                {t(day.working ? "profile.work_day" : "profile.day_off")}
              </label>
              {/* spec:impl working-hours-booking-rules#allow-one-interval-day-start */}
              <div className="profile-work-times">
                <label>
                  <span>{t("extra.profile_work_start")}</span>
                  <select
                    value={day.start}
                    disabled={!day.working}
                    onChange={(event) => change(weekday, { start: event.currentTarget.value })}
                  >
                    {quarterHours.map((time) => (
                      <option key={time}>{time}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>{t("extra.profile_work_end")}</span>
                  <select
                    value={day.end}
                    disabled={!day.working}
                    onChange={(event) => change(weekday, { end: event.currentTarget.value })}
                  >
                    {quarterHours.map((time) => (
                      <option key={time}>{time}</option>
                    ))}
                  </select>
                </label>
              </div>
              {day.working && day.end <= day.start && (
                <p className="profile-error" role="alert">
                  {t("extra.profile_work_order")}
                </p>
              )}
            </fieldset>
          );
        })}
      </div>
      {!value.some((day) => day.working) && (
        <p className="profile-hint">{t("extra.profile_no_work_days")}</p>
      )}
    </div>
  );
}
