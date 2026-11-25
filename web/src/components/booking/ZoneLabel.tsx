import type { ReactElement } from "react";
import { utcOffset, zoneCity } from "@/lib/format";
import { useLanguage, useTranslation } from "@/lib/i18n";

export function ZoneLabel({ timeZone, at }: { timeZone: string; at: Date }): ReactElement {
  const t = useTranslation();
  const city = zoneCity(timeZone, useLanguage());
  const offset = utcOffset(timeZone, at);

  return (
    <p className="booking-hint">{t("public.tz_label", { city, город: city, "±N": offset })}</p>
  );
}
