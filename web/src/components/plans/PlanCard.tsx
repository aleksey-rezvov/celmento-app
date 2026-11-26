import type { ReactElement, ReactNode } from "react";
import { useTranslation } from "@/lib/i18n";

interface PlanCardProps {
  kind: "free" | "subscription";
  current: boolean;
  children?: ReactNode;
}

export function PlanCard({ kind, current, children }: PlanCardProps): ReactElement {
  const t = useTranslation();
  const subscription = kind === "subscription";

  return (
    <section className="plans-card">
      <div className="plans-card-heading">
        <h2>{t(subscription ? "plans.subscription" : "plans.free")}</h2>
        {/* spec:impl subscription-plans-request#mark-current-plan-current-free */}
        {current && <span className="plans-current">{t("plans.current")}</span>}
      </div>
      <ul className="plans-feature-list">
        <li>{t(subscription ? "plans.clients_unlimited" : "plans.clients_3")}</li>
        <li>{t("plans.all_features")}</li>
        {subscription && (
          <li className="plans-hint">
            <span>{t("plans.future_features")}</span>
            <span className="plans-soon">{t("plans.soon")}</span>
          </li>
        )}
      </ul>
      {children}
    </section>
  );
}
