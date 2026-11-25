"use client";

import type { ReactElement } from "react";
import { formatDate } from "@/lib/format";
import { useLanguage, useTranslation } from "@/lib/i18n";

interface DateSubtitleProps {
  day: string;
  today: string;
  expanded: boolean;
  onOpen: () => void;
}

export function DateSubtitle({ day, today, expanded, onOpen }: DateSubtitleProps): ReactElement {
  const language = useLanguage();
  const t = useTranslation();
  // spec:impl schedule-date-navigation#show-header-date-subtitle-chevron
  const name = day === today ? t("meetings.today") : formatDate(day, "UTC", language);

  return (
    <button
      className="schedule-date-subtitle"
      type="button"
      onClick={onOpen}
      aria-haspopup="dialog"
      aria-expanded={expanded}
    >
      {name}
      <span aria-hidden="true">⌄</span>
    </button>
  );
}
