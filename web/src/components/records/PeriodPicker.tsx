import { useState, type ReactElement } from "react";
import { ChoiceChips } from "@/components/shell/ChoiceChips";
import { Sheet } from "@/components/shell/Sheet";
import { useAccount } from "@/lib/account";
import type { Schemas } from "@/lib/api/client";
import { useLanguage, useTranslation, type MessageKey } from "@/lib/i18n";
import { periodLabel, periodOptions, usePeriod } from "@/lib/records-period";
import { zonedDay } from "@/lib/zoned-date";

type Period = Schemas["RecordsPeriod"];
const kinds = ["all", "year", "month", "week", "custom"] as const;

interface DateRangeProps {
  period: Period;
  onApply: (period: Period) => void;
}

function DateRange({ period, onApply }: DateRangeProps): ReactElement {
  const { account } = useAccount();
  const t = useTranslation();
  const today = zonedDay(new Date(), account.time_zone);
  const [from, setFrom] = useState(period.from ?? today);
  const [to, setTo] = useState(period.to ?? today);
  const rangeReady = from !== "" && to !== "" && from <= to;

  return (
    <form
      className="records-date-range"
      onSubmit={(event) => {
        event.preventDefault();
        if (rangeReady) onApply({ kind: "custom", from, to });
      }}
    >
      <label className="auth-field">
        <span>{t("extra.records_from")}</span>
        <input
          type="date"
          required
          value={from}
          onChange={(event) => setFrom(event.currentTarget.value)}
        />
      </label>
      <label className="auth-field">
        <span>{t("extra.records_to")}</span>
        <input
          type="date"
          required
          min={from}
          value={to}
          onChange={(event) => setTo(event.currentTarget.value)}
        />
      </label>
      <button className="shell-primary" type="submit" disabled={!rangeReady}>
        {t("extra.records_apply")}
      </button>
    </form>
  );
}

interface PeriodPickerProps {
  title?: MessageKey;
  allTimeLabel?: MessageKey;
}

export function PeriodPicker({
  title = "acc.title",
  allTimeLabel = periodOptions.all,
}: PeriodPickerProps): ReactElement {
  const t = useTranslation();
  const language = useLanguage();
  const [period, setPeriod] = usePeriod();
  const [picker, setPicker] = useState<"choices" | "range" | null>(null);

  function apply(selection: Period): void {
    setPeriod(selection);
    setPicker(null);
  }

  // spec:impl accounting-summary#show-current-period-title-subtitle
  return (
    <>
      <button
        className="records-period-button"
        type="button"
        onClick={() => setPicker("choices")}
        aria-haspopup="dialog"
        aria-expanded={picker !== null}
      >
        {period.kind === "all" ? t(allTimeLabel) : periodLabel(period, language, t)}{" "}
        <span aria-hidden="true">⌄</span>
      </button>
      {picker !== null && (
        <Sheet
          title={t(picker === "range" ? "acc.period_custom" : title)}
          onClose={() => setPicker(null)}
        >
          {picker === "range" ? (
            <DateRange period={period} onApply={apply} />
          ) : (
            <ChoiceChips
              label={t(title)}
              value={period.kind}
              options={kinds.map((value) => ({
                value,
                label: t(value === "all" ? allTimeLabel : periodOptions[value]),
              }))}
              onChange={(kind) => {
                if (kind === "custom") setPicker("range");
                else apply({ kind, from: null, to: null });
              }}
            />
          )}
        </Sheet>
      )}
    </>
  );
}
