import type { ReactElement } from "react";
import { EmptyState } from "@/components/shell/EmptyState";
import { useAccount } from "@/lib/account";
import { useTranslation } from "@/lib/i18n";
import { SpecialistRow } from "./SpecialistRow";
import type { useSpecialists } from "./specialist-data";

interface MySpecialistsProps {
  resource: ReturnType<typeof useSpecialists>;
}

export function MySpecialists({ resource }: MySpecialistsProps): ReactElement {
  const { account } = useAccount();
  const t = useTranslation();
  const { result, retry } = resource;
  const items = result?.kind === "ready" ? result.data.items : null;

  // spec:impl client-my-specialists#show-my-specialists-section-people-tab
  // spec:impl client-my-specialists#offer-way-add-leader-section
  return (
    <section className="shell-people-section" aria-label={t("c.my_specialists")}>
      <h2>{t("c.my_specialists")}</h2>
      {/* spec:impl client-my-specialists#show-no-specialists-no-card-linked */}
      {items ? (
        items.length > 0 ? (
          <ul className="clients-list">
            {items.map((item) => (
              <SpecialistRow key={item.specialist.id} item={item} />
            ))}
          </ul>
        ) : account.activated ? (
          <p className="client-row-detail">{t("c.no_specialists")}</p>
        ) : (
          <EmptyState character="specialists_empty" textKey="c.no_specialists" />
        )
      ) : result ? (
        <div className="clients-error">
          <p role="alert">
            {t(
              result.kind === "offline" ? "extra.auth_network_error" : "extra.auth_request_failed",
            )}
          </p>
          <button type="button" className="shell-secondary" onClick={retry}>
            {t("extra.auth_retry")}
          </button>
        </div>
      ) : (
        <div aria-busy="true" />
      )}
    </section>
  );
}
