"use client";

import {
  createContext,
  createElement,
  useContext,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import type { Schemas } from "./api/client";
import type { operations } from "./api/schema";
import { formatDate } from "./format";
import type { Language, MessageKey, Translate } from "./i18n/messages";

type Period = Schemas["RecordsPeriod"];
type PeriodKind = Schemas["RecordsPeriodKind"];
type PeriodState = [Period, (period: Period) => void];
type SummaryQuery = NonNullable<operations["getRecordsSummary"]["parameters"]["query"]>;

const PeriodContext = createContext<PeriodState | null>(null);
const defaultPeriod: Period = { kind: "all", from: null, to: null };

export const periodOptions = {
  all: "acc.period_all",
  year: "acc.period_year",
  month: "acc.period_month",
  week: "acc.period_week",
  custom: "acc.period_custom",
} as const satisfies Record<PeriodKind, MessageKey>;

interface RecordsPeriodProviderProps {
  children: ReactNode;
}

export function RecordsPeriodProvider({ children }: RecordsPeriodProviderProps): ReactElement {
  // spec:impl accounting-summary#keep-chosen-period-leader-stays
  const value = useState<Period>(defaultPeriod);
  return createElement(PeriodContext.Provider, { value }, children);
}

export function usePeriod(): PeriodState {
  const value = useContext(PeriodContext);
  if (value === null) throw new Error("Records period requires the Records layout.");
  return value;
}

export function periodQuery(period: Period): SummaryQuery {
  return {
    period: period.kind,
    ...(period.kind === "custom" && { from: period.from ?? undefined, to: period.to ?? undefined }),
  };
}

export function recordsDate(day: string, language: Language): string {
  return formatDate(day + "T00:00:00Z", "UTC", language, { year: "numeric" });
}

export function periodLabel(period: Period, language: Language, t: Translate): string {
  if (period.kind === "custom" && period.from && period.to) {
    return recordsDate(period.from, language) + " – " + recordsDate(period.to, language);
  }
  return t(periodOptions[period.kind]);
}
