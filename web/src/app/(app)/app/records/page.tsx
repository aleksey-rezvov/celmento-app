"use client";

import type { ReactElement } from "react";
import { MoneyLine } from "@/components/records/MoneyLine";
import { PeriodPicker } from "@/components/records/PeriodPicker";
import { RecordsLoadState } from "@/components/records/RecordsScreen";
import { SummaryTile } from "@/components/records/SummaryTile";
import { useRecordsSummary } from "@/components/records/records-data";
import {
  balancesPath,
  formatRecordsHours,
  hoursPath,
  operationsPath,
} from "@/components/records/records-display";
import { EmptyState } from "@/components/shell/EmptyState";
import { ScreenHeader } from "@/components/shell/ScreenHeader";
import type { Schemas } from "@/lib/api/client";
import { useLanguage, useTranslation } from "@/lib/i18n";
import { usePeriod } from "@/lib/records-period";

interface SummaryProps {
  summary: Schemas["RecordsSummary"];
}

function Summary({ summary }: SummaryProps): ReactElement {
  const t = useTranslation();
  const language = useLanguage();
  const details = [
    { label: "hours.supervision", value: summary.supervision_hours },
    { label: "hours.therapy", value: summary.personal_therapy_hours },
    { label: "hours.training", value: summary.training_hours },
  ] as const;

  return (
    <>
      {/* spec:impl accounting-summary#show-summary-zeros-curiosity-character */}
      {!summary.has_outcomes && <EmptyState character="records_empty" textKey="acc.empty" />}
      {/* spec:impl accounting-summary#open-records-tab-screen-8-1 */}
      <div className="records-tiles">
        {/* spec:impl accounting-summary#open-operations-feed-income-filter */}
        <SummaryTile
          title="acc.income"
          tone="income"
          href={operationsPath + "?kind=income"}
          value={<MoneyLine items={summary.income} />}
          empty={summary.income.length === 0 && summary.receipts.length === 0}
        >
          <p className="records-tile-detail">
            {t("acc.receipts")} <MoneyLine items={summary.receipts} />
          </p>
        </SummaryTile>
        {/* spec:impl accounting-summary#show-practice-hours-tile-practice-hours */}
        {/* spec:impl accounting-summary#open-hours-log-practice-tab */}
        <SummaryTile
          title="acc.practice_hours"
          tone="practice"
          href={hoursPath + "?type=practice"}
          value={formatRecordsHours(summary.practice_hours, language)}
          empty={summary.completed_sessions === 0}
        >
          <p className="records-tile-detail">
            {t("acc.sessions", { N: summary.completed_sessions })}
          </p>
        </SummaryTile>
        <SummaryTile
          title="acc.expenses"
          tone="expenses"
          href={operationsPath + "?kind=expenses"}
          value={<MoneyLine items={summary.expenses} absolute />}
          empty={summary.expenses.length === 0}
        />
        {/* spec:impl accounting-summary#show-prepaid-debts-tile-sum-positive */}
        <SummaryTile
          title="acc.prepaid_debts"
          tone="balances"
          href={balancesPath}
          value={<MoneyLine items={summary.prepaid} />}
          empty={summary.prepaid.length === 0 && summary.debts.length === 0}
        >
          <p className="records-tile-detail">{t("acc.prepaid")}</p>
          <p className="records-tile-detail records-debt">
            {t("acc.debts")} <MoneyLine items={summary.debts} />
          </p>
        </SummaryTile>
        {/* spec:impl accounting-summary#show-growth-hours-tile-sum-supervision */}
        <SummaryTile
          title="acc.growth_hours"
          tone="growth"
          href={hoursPath + "?type=supervision"}
          value={formatRecordsHours(summary.growth_hours, language)}
          empty={summary.growth_hours === 0}
        >
          {details.map(({ label, value }) => (
            <p className="records-tile-detail" key={label}>
              {t(label)}{" "}
              {t("extra.records_hours_amount", { H: formatRecordsHours(value, language) })}
            </p>
          ))}
        </SummaryTile>
      </div>
    </>
  );
}

export default function Records(): ReactElement {
  const t = useTranslation();
  const [period] = usePeriod();
  const { data, error, retry } = useRecordsSummary(period);

  return (
    <main className="records-page">
      <ScreenHeader title={t("acc.title")} subtitle={<PeriodPicker />} />
      {/* spec:impl accounting-summary#recompute-tiles-chosen-period-soon */}
      {data ? <Summary summary={data} /> : <RecordsLoadState error={error} retry={retry} />}
    </main>
  );
}
