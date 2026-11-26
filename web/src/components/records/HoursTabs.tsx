import type { ReactElement } from "react";
import { ChoiceChips } from "@/components/shell/ChoiceChips";
import type { Schemas } from "@/lib/api/client";
import { useTranslation } from "@/lib/i18n";
import { logLabels } from "./records-display";

type Log = Schemas["RecordsHoursLogType"];
export const logs = ["practice", "supervision", "therapy", "training"] as const;

interface HoursTabsProps {
  value: Log;
  onChange: (value: Log) => void;
}

export function HoursTabs({ value, onChange }: HoursTabsProps): ReactElement {
  const t = useTranslation();

  return (
    <ChoiceChips
      label={t("hours.title")}
      value={value}
      options={logs.map((log) => ({ value: log, label: t(logLabels[log]) }))}
      onChange={onChange}
    />
  );
}
