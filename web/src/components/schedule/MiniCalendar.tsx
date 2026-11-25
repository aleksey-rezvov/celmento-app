"use client";

import { useEffect, useState, type ReactElement } from "react";
import { Sheet } from "@/components/shell/Sheet";
import { useAccount } from "@/lib/account";
import { apiClient } from "@/lib/api/client";
import { useLanguage, useTranslation } from "@/lib/i18n";
import { getSessionToken } from "@/lib/session";
import { civilDate, firstCivilDayOfWeek, shiftCivilDay, shiftCivilMonth } from "@/lib/zoned-date";

interface MiniCalendarProps {
  selected: string;
  today: string;
  onPick: (day: string) => void;
  onClose: () => void;
}

interface CalendarResult {
  month: string;
  days: readonly string[] | null;
}

export function MiniCalendar({
  selected,
  today,
  onPick,
  onClose,
}: MiniCalendarProps): ReactElement {
  const t = useTranslation();
  const language = useLanguage();
  const { account } = useAccount();
  const locale = language === "ru" ? "ru-RU" : "en-GB";
  // spec:impl schedule-date-navigation#open-mini-month-calendar-month
  const [month, setMonth] = useState(selected.slice(0, 7));
  const [result, setResult] = useState<CalendarResult | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    async function load(): Promise<void> {
      try {
        const { data } = await apiClient(getSessionToken()).GET("/meetings/calendar", {
          params: { query: { month } },
          signal,
          cache: "no-store",
        });
        if (!signal.aborted) setResult({ month, days: data?.days ?? null });
      } catch {
        if (!signal.aborted) setResult({ month, days: null });
      }
    }

    void load();
    return () => controller.abort();
  }, [account.id, account.time_zone, attempt, month]);

  const monthName = new Intl.DateTimeFormat(locale, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(civilDate(month + "-01"));
  const weekdayName = new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" });
  const fullDay = new Intl.DateTimeFormat(locale, { dateStyle: "full", timeZone: "UTC" });
  const first = firstCivilDayOfWeek(month + "-01");
  const nextMonth = shiftCivilMonth(month, 1);
  const days = Array.from({ length: 42 }, (_, index) => shiftCivilDay(first, index)).filter(
    (day) => day < nextMonth + "-01",
  );
  const outcome = result?.month === month ? result : null;
  const meetingDays = new Set(outcome?.days ?? []);

  // spec:impl schedule-date-navigation#show-meetings-details-inside-mini
  return (
    <Sheet title={t("extra.schedule_calendar")} onClose={onClose}>
      {/* spec:impl schedule-date-navigation#let-person-move-previous-next */}
      <div className="schedule-calendar-heading">
        <button
          type="button"
          className="shell-icon-button"
          aria-label={t("extra.schedule_previous_month")}
          onClick={() => setMonth((value) => shiftCivilMonth(value, -1))}
        >
          <span aria-hidden="true">‹</span>
        </button>
        <p>{monthName}</p>
        <button
          type="button"
          className="shell-icon-button"
          aria-label={t("extra.schedule_next_month")}
          onClick={() => setMonth((value) => shiftCivilMonth(value, 1))}
        >
          <span aria-hidden="true">›</span>
        </button>
      </div>
      <div className="schedule-calendar-grid" aria-busy={!outcome}>
        {days.slice(0, 7).map((day) => (
          <span key={day} className="schedule-calendar-weekday">
            {weekdayName.format(civilDate(day))}
          </span>
        ))}
        {days.map((day) => {
          if (!day.startsWith(month)) return <span key={day} aria-hidden="true" />;
          const marked = meetingDays.has(day);
          return (
            <button
              key={day}
              type="button"
              className="schedule-calendar-day"
              aria-label={
                fullDay.format(civilDate(day)) + (marked ? `, ${t("meetings.title")}` : "")
              }
              aria-current={day === today ? "date" : undefined}
              aria-pressed={day === selected}
              onClick={() => onPick(day)}
            >
              {Number(day.slice(8))}
              {marked && <span className="schedule-calendar-dot" aria-hidden="true" />}
            </button>
          );
        })}
      </div>
      {outcome?.days === null && (
        <p role="alert" className="schedule-error">
          {t("extra.auth_request_failed")}{" "}
          <button
            className="schedule-link"
            type="button"
            onClick={() => setAttempt((value) => value + 1)}
          >
            {t("extra.auth_retry")}
          </button>
        </p>
      )}
    </Sheet>
  );
}
