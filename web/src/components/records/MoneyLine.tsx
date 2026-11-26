import type { ReactElement } from "react";
import type { Schemas } from "@/lib/api/client";
import { formatMoneyLine } from "@/lib/format";
import { useLanguage } from "@/lib/i18n";

interface MoneyLineProps {
  items: readonly Schemas["Money"][];
  absolute?: boolean;
}

export function MoneyLine({ items, absolute = false }: MoneyLineProps): ReactElement {
  const language = useLanguage();
  const amounts = absolute
    ? items.map((money) => ({ ...money, amount: money.amount.replace(/^-/u, "") }))
    : items;

  // spec:impl accounting-summary#compute-money-indicator-separately
  return <span>{formatMoneyLine(amounts, language) || "0"}</span>;
}
