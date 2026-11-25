"use client";

import type { ReactElement } from "react";
import { useLanguage } from "@/lib/i18n";
import { civilDate, shiftCivilDay } from "@/lib/zoned-date";

interface WeekSeparatorProps {
  monday: string;
}

export function WeekSeparator({ monday }: WeekSeparatorProps): ReactElement {
  const language = useLanguage();
  const sunday = shiftCivilDay(monday, 6);
  const month = new Intl.DateTimeFormat(language === "ru" ? "ru-RU" : "en-GB", {
    month: "short",
    timeZone: "UTC",
  });
  const firstMonth =
    monday.slice(0, 7) === sunday.slice(0, 7) ? "" : ` ${month.format(civilDate(monday))}`;
  const label = `${Number(monday.slice(8))}${firstMonth}–${Number(sunday.slice(8))} ${month.format(civilDate(sunday))}`;

  return <h2 className="schedule-week">{label}</h2>;
}
