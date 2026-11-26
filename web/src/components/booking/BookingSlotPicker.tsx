import type { ReactElement } from "react";
import type { Schemas } from "@/lib/api/client";
import { formatDate } from "@/lib/format";
import { useLanguage, useTranslation } from "@/lib/i18n";
import { civilDate, shiftCivilDay, zonedInstant } from "@/lib/zoned-date";
import { BookingLoadState } from "./BookingScreen";
import { bookingDaysAhead, DateStrip } from "./DateStrip";
import { SlotGrid } from "./SlotGrid";
import { ZoneLabel } from "./ZoneLabel";

interface BookingSlotPickerProps {
  today: string;
  day: string;
  timeZone: string;
  now: Date;
  slots: Schemas["BookingSlotList"] | null;
  error?: "error" | "offline";
  onDay: (day: string) => void;
  onSlot: (startsAt: string) => void;
  retry: () => void;
}

export function BookingSlotPicker({
  today,
  day,
  timeZone,
  now,
  slots,
  error,
  onDay,
  onSlot,
  retry,
}: BookingSlotPickerProps): ReactElement {
  const t = useTranslation();
  const language = useLanguage();
  const nextDate = slots?.next_free_date;
  const end = shiftCivilDay(today, bookingDaysAhead);
  const next = nextDate && nextDate > day && nextDate <= end ? nextDate : null;
  const referenceTime = slots?.items[0]?.starts_at ?? zonedInstant(day, "12:00", timeZone);

  return (
    <section className="booking-card booking-picker">
      <DateStrip
        today={today}
        selected={day}
        onPick={(picked) => {
          if (picked === day) retry();
          else onDay(picked);
        }}
      />
      <ZoneLabel timeZone={timeZone} at={referenceTime ? new Date(referenceTime) : now} />
      {slots ? (
        slots.items.length > 0 ? (
          <SlotGrid slots={slots} timeZone={timeZone} onPick={onSlot} />
        ) : (
          <>
            {/* spec:impl public-booking-page#show-no-slots-day-next-free-button */}
            <p className="booking-hint">{t("public.no_slots_day")}</p>
            {next && (
              <button type="button" className="auth-secondary" onClick={() => onDay(next)}>
                {t("public.next_free", {
                  [language === "ru" ? "дата" : "date"]: formatDate(
                    civilDate(next).toISOString(),
                    "UTC",
                    language,
                  ),
                })}
              </button>
            )}
          </>
        )
      ) : (
        <BookingLoadState error={error} retry={retry} />
      )}
    </section>
  );
}
