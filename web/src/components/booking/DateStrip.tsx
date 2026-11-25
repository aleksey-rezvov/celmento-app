import { useEffect, useRef, type ReactElement } from "react";
import { formatDate } from "@/lib/format";
import { useLanguage, useTranslation } from "@/lib/i18n";
import { civilDate, shiftCivilDay } from "@/lib/zoned-date";

interface DateStripProps {
  today: string;
  selected: string;
  onPick: (day: string) => void;
}

export const bookingDaysAhead = 28;

export function DateStrip({ today, selected, onPick }: DateStripProps): ReactElement {
  const language = useLanguage();
  const t = useTranslation();
  const strip = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = strip.current;
    const picked = element?.querySelector('button[aria-pressed="true"]');
    if (!element || !picked) return;
    const bounds = element.getBoundingClientRect();
    const chip = picked.getBoundingClientRect();
    if (chip.right > bounds.right) element.scrollLeft += chip.right - bounds.right;
    else if (chip.left < bounds.left) element.scrollLeft += chip.left - bounds.left;
  }, [selected]);

  // spec:impl public-booking-page#show-date-strip-today-4-weeks
  return (
    <div ref={strip} className="booking-date-strip" role="group" aria-label={t("form.date")}>
      {Array.from({ length: bookingDaysAhead + 1 }, (_, offset) => {
        const day = shiftCivilDay(today, offset);
        return (
          <button
            className="booking-chip"
            key={day}
            type="button"
            aria-pressed={selected === day}
            onClick={() => onPick(day)}
          >
            <time dateTime={day}>{formatDate(civilDate(day).toISOString(), "UTC", language)}</time>
          </button>
        );
      })}
    </div>
  );
}
