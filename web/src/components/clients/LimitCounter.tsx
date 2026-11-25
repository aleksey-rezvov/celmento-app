"use client";

import type { ReactElement } from "react";
import type { Schemas } from "@/lib/api/client";
import { useTranslation } from "@/lib/i18n";
import { activeClientLimitReached } from "@/lib/limit";

interface LimitCounterProps {
  plan: Schemas["PlanStatus"];
}

export function LimitCounter({ plan }: LimitCounterProps): ReactElement | null {
  const t = useTranslation();

  // spec:impl client-list#show-limit-counter-leader-subscription
  if (plan.kind === "subscription" || plan.client_limit === null) return null;

  // spec:impl client-list#show-limit-counter-section-title-free
  return (
    <p className="clients-limit-counter" data-reached={activeClientLimitReached(plan)}>
      {t("clients.limit_counter", { N: plan.active_clients })}
    </p>
  );
}
