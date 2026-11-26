import type { ReactElement } from "react";
import type { Schemas } from "@/lib/api/client";
import { useLanguage, useTranslation } from "@/lib/i18n";
import { formatRecordsHours } from "./records-display";

interface HoursBreakdownProps {
  value: Schemas["RecordsHoursBreakdown"];
}

export function HoursBreakdown({ value }: HoursBreakdownProps): ReactElement {
  const t = useTranslation();
  const language = useLanguage();
  const rows = [
    ["hours.paid", value.paid],
    ["hours.pro_bono", value.pro_bono],
    ["hours.individual", value.individual],
  ] as const;

  // spec:impl hours-log#show-totals-breakdown-chosen-period
  return (
    <dl className="records-hours-breakdown">
      {rows.map(
        ([label, hours]) =>
          hours !== null && (
            <div key={label}>
              <dt>{t(label)}</dt>
              <dd>{t("extra.records_hours_amount", { H: formatRecordsHours(hours, language) })}</dd>
            </div>
          ),
      )}
    </dl>
  );
}
