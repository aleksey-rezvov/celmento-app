import type { ReactElement } from "react";
import type { Schemas } from "@/lib/api/client";
import { formatTime, utcOffset } from "@/lib/format";
import { useLanguage, useTranslation } from "@/lib/i18n";

interface SlotGridProps {
  slots: Schemas["BookingSlotList"];
  timeZone: string;
  onPick: (startsAt: string) => void;
}

export function SlotGrid({ slots, timeZone, onPick }: SlotGridProps): ReactElement {
  const language = useLanguage();
  const t = useTranslation();
  const times = slots.items.map(({ starts_at }) => formatTime(starts_at, timeZone, language));
  const occurrences = new Map<string, number>();
  for (const time of times) occurrences.set(time, (occurrences.get(time) ?? 0) + 1);

  // spec:impl public-booking-page#render-date-slot-time-guest
  return (
    <div className="booking-slot-grid" role="group" aria-label={t("form.start")}>
      {slots.items.map(({ starts_at }, index) => {
        const time = times[index] ?? "";
        const repeated = (occurrences.get(time) ?? 0) > 1;
        return (
          <button
            type="button"
            key={starts_at}
            className="booking-chip"
            onClick={() => onPick(starts_at)}
          >
            <time dateTime={starts_at}>
              {time}
              {repeated && " (UTC" + utcOffset(timeZone, new Date(starts_at)) + ")"}
            </time>
          </button>
        );
      })}
    </div>
  );
}
