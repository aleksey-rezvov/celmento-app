"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useState, type ReactElement } from "react";
import { OperationRow } from "@/components/records/OperationRow";
import {
  RecordsListEmpty,
  RecordsLoadState,
  RecordsScreen,
} from "@/components/records/RecordsScreen";
import { useRecordsOperations } from "@/components/records/records-data";
import { operationLabels } from "@/components/records/records-display";
import { ChoiceChips } from "@/components/shell/ChoiceChips";
import type { Schemas } from "@/lib/api/client";
import { useTranslation } from "@/lib/i18n";
import { usePeriod } from "@/lib/records-period";

type Filter = Schemas["RecordsOperationFilter"];
const filters = ["all", "income", "receipts", "expenses"] as const;

interface OperationsProps {
  initial: Filter;
}

function Operations({ initial }: OperationsProps): ReactElement {
  const t = useTranslation();
  const [period] = usePeriod();
  const [filter, setFilter] = useState<Filter>(initial);
  const { data, error, retry } = useRecordsOperations(period, filter);

  // spec:impl money-operations-feed#show-screen-8-2-titled-operations
  // spec:impl money-operations-feed#allow-editing-deleting-row-feed
  return (
    <RecordsScreen title="feed.title">
      {/* spec:impl money-operations-feed#show-above-list-filters-all */}
      <ChoiceChips
        label={t("feed.title")}
        value={filter}
        options={filters.map((value) => ({ value, label: t(operationLabels[value]) }))}
        onChange={setFilter}
      />
      {data ? (
        data.items.length > 0 ? (
          <ul className="records-list">
            {data.items.map((operation) => (
              <OperationRow key={operation.kind + ":" + operation.id} operation={operation} />
            ))}
          </ul>
        ) : (
          // spec:impl money-operations-feed#show-empty-state-empty-tile-sentence
          <RecordsListEmpty />
        )
      ) : (
        <RecordsLoadState error={error} retry={retry} />
      )}
    </RecordsScreen>
  );
}

function RequestedOperations(): ReactElement {
  const value = useSearchParams().get("kind");
  // spec:impl money-operations-feed#preselect-income-opened-income-tile
  const initial = filters.find((filter) => filter === value) ?? "all";
  return <Operations key={initial} initial={initial} />;
}

export default function OperationsPage(): ReactElement {
  return (
    <Suspense
      fallback={
        <RecordsScreen title="feed.title">
          <div aria-busy="true" />
        </RecordsScreen>
      }
    >
      <RequestedOperations />
    </Suspense>
  );
}
