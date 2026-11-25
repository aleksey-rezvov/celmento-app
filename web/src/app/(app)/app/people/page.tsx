"use client";

import { useId, useState, type ReactElement } from "react";
import { NoticeBar } from "@/components/NoticeBar";
import { ClientSearchToggle } from "@/components/clients/ClientSearch";
import { ClientsSection } from "@/components/clients/ClientsSection";
import { EmptyState } from "@/components/shell/EmptyState";
import { ScreenHeader } from "@/components/shell/ScreenHeader";
import { useAccount } from "@/lib/account";
import { useTranslation } from "@/lib/i18n";
import "./clients.css";

function MySpecialistsSlot(): ReactElement {
  const t = useTranslation();

  return (
    <section className="shell-people-section" aria-label={t("c.my_specialists")}>
      <h2>{t("c.my_specialists")}</h2>
      <EmptyState character="specialists_empty" textKey="c.no_specialists" />
    </section>
  );
}

export default function People(): ReactElement {
  const { account } = useAccount();
  const t = useTranslation();
  const [search, setSearch] = useState<string | null>(null);
  const searchId = useId();

  return (
    <main>
      <ScreenHeader
        title={t("people.title")}
        actions={
          account.activated && (
            <ClientSearchToggle
              expanded={search !== null}
              controls={searchId}
              onToggle={() => setSearch((value) => (value === null ? "" : null))}
            />
          )
        }
      />
      <NoticeBar tab="people" />
      {/* spec:impl mobile-app-shell#show-people-tab-leader-clients */}
      {/* spec:impl client-leading-activation#show-non-leader-people-tab-only-specialists */}
      {/* spec:impl client-list#show-clients-section-titled-people */}
      {account.activated && (
        <ClientsSection searchId={searchId} search={search} onSearch={setSearch} />
      )}
      <MySpecialistsSlot />
    </main>
  );
}
