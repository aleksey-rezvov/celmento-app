"use client";

import type { ReactElement } from "react";
import type { Schemas } from "@/lib/api/client";
import { useLanguage, useTranslation, type MessageKey } from "@/lib/i18n";

type WorkingDay = Schemas["WorkingDay"];
type WorkingInterval = Schemas["WorkingInterval"];

const weekdays: readonly Schemas["Weekday"][] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const quarterHours = Array.from({ length: 96 }, (_, index) => {
  const hours = Math.floor(index / 4)
    .toString()
    .padStart(2, "0");
  const minutes = ((index % 4) * 15).toString().padStart(2, "0");
  return hours + ":" + minutes;
});

const timeFields = [
  ["start", "extra.profile_work_start"],
  ["end", "extra.profile_work_end"],
] as const;

function intervalsOf(day: WorkingDay): WorkingInterval[] {
  return [{ start: day.start, end: day.end }, ...(day.additional_intervals ?? [])];
}

export function workingHoursIssue(day: WorkingDay): MessageKey | null {
  if (!day.working && !day.additional_intervals?.length) return null;
  const intervals = intervalsOf(day).sort((first, second) =>
    first.start.localeCompare(second.start),
  );
  if (intervals.some(({ start, end }) => start >= end)) return "extra.profile_work_order";
  // spec:impl working-hours-booking-rules#validate-working-intervals
  if (intervals.some(({ end }, index) => end > (intervals[index + 1]?.start ?? end)))
    return "extra.profile_work_overlap";
  return null;
}

function nextInterval(intervals: WorkingInterval[], duration: number): WorkingInterval | undefined {
  const lastEnd = intervals.reduce((latest, { end }) => (end > latest ? end : latest), "00:00");
  function opening(quarters: number): WorkingInterval | undefined {
    let earlier: WorkingInterval | undefined;
    for (const [index, start] of quarterHours.entries()) {
      const end = quarterHours[index + quarters];
      if (!end) break;
      if (intervals.some((interval) => start < interval.end && end > interval.start)) continue;
      if (start >= lastEnd) return { start, end };
      earlier ??= { start, end };
    }
    return earlier;
  }
  return opening(duration / 15) ?? opening(1);
}

interface WorkingHoursEditorProps {
  value: WorkingDay[];
  duration: number;
  onChange: (value: WorkingDay[]) => void;
}

export function WorkingHoursEditor({
  value,
  duration,
  onChange,
}: WorkingHoursEditorProps): ReactElement {
  const t = useTranslation();
  const language = useLanguage();
  const dayNames = new Intl.DateTimeFormat(language, { weekday: "long", timeZone: "UTC" });

  function change(weekday: Schemas["Weekday"], changes: Partial<WorkingDay>): void {
    onChange(value.map((day) => (day.weekday === weekday ? { ...day, ...changes } : day)));
  }

  // spec:impl working-hours-booking-rules#allow-more-one-working-interval
  function changeIntervals(weekday: Schemas["Weekday"], intervals: WorkingInterval[]): void {
    const [first, ...others] = intervals;
    if (first) change(weekday, { ...first, additional_intervals: others });
  }

  return (
    <div className="profile-work-editor">
      <div className="profile-group">
        {/* spec:impl working-hours-booking-rules#show-screen-2-3-7-days */}
        {weekdays.map((weekday, index) => {
          const day = value.find((candidate) => candidate.weekday === weekday);
          if (!day) return null;
          const name = dayNames.format(new Date(Date.UTC(2024, 0, index + 1)));
          const intervals = intervalsOf(day);
          const next = day.working ? nextInterval(intervals, duration) : undefined;
          const issue = workingHoursIssue(day);
          const removable = intervals.length > 1;

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
              {intervals.map((interval, position) => (
                <div key={position} className="profile-work-times" data-removable={removable}>
                  {/* spec:impl working-hours-booking-rules#allow-one-interval-day-start */}
                  {timeFields.map(([field, label]) => (
                    <label key={field}>
                      <span>{t(label)}</span>
                      <select
                        value={interval[field]}
                        disabled={!day.working}
                        onChange={(event) => {
                          const time = event.currentTarget.value;
                          changeIntervals(
                            weekday,
                            intervals.map((entry, index) =>
                              index === position ? { ...entry, [field]: time } : entry,
                            ),
                          );
                        }}
                      >
                        {quarterHours.map((time) => (
                          <option key={time}>{time}</option>
                        ))}
                      </select>
                    </label>
                  ))}
                  {removable && (
                    <button
                      className="profile-secondary profile-work-remove"
                      type="button"
                      disabled={!day.working}
                      title={t("extra.profile_work_remove_interval")}
                      aria-label={t("extra.profile_work_remove_interval")}
                      onClick={() =>
                        changeIntervals(
                          weekday,
                          intervals.filter((_, index) => index !== position),
                        )
                      }
                    >
                      <span aria-hidden="true">×</span>
                    </button>
                  )}
                </div>
              ))}
              {day.working && (
                <button
                  type="button"
                  className="profile-secondary profile-work-add"
                  disabled={!next}
                  onClick={() => {
                    if (next) changeIntervals(weekday, [...intervals, next]);
                  }}
                >
                  {t("extra.profile_work_add_interval")}
                </button>
              )}
              {issue && (
                <p className="profile-error" role="alert">
                  {t(issue)}
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
