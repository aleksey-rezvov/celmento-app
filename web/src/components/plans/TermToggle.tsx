import type { ReactElement } from "react";
import { ChoiceChips } from "@/components/shell/ChoiceChips";
import type { Schemas } from "@/lib/api/client";
import { useTranslation } from "@/lib/i18n";

type Term = Schemas["SubscriptionTerm"];

interface TermToggleProps {
  term: Term;
  busy: boolean;
  onChange: (term: Term) => void;
}

export function TermToggle({ term, busy, onChange }: TermToggleProps): ReactElement {
  const t = useTranslation();

  // spec:impl subscription-plans-request#show-month-year-toggle-subscription
  return (
    <ChoiceChips
      label={t("plans.subscription")}
      value={term}
      options={[
        { value: "month", label: t("plans.month"), disabled: busy },
        { value: "year", label: t("plans.year"), disabled: busy },
      ]}
      onChange={onChange}
    />
  );
}
