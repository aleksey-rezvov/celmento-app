"use client";

import type { ReactElement } from "react";
import { NoticeBar } from "@/components/NoticeBar";
import { EmptyState } from "@/components/shell/EmptyState";
import { ScreenHeader } from "@/components/shell/ScreenHeader";
import { useAccount } from "@/lib/account";
import { useTranslation } from "@/lib/i18n";

export default function People(): ReactElement {
  const { account } = useAccount();
  const t = useTranslation();

  return (
    <main>
      <ScreenHeader title={t("people.title")} />
      <NoticeBar tab="people" />
      {/* spec:impl mobile-app-shell#show-people-tab-leader-clients */}
      {/* spec:impl client-leading-activation#show-non-leader-people-tab-only-specialists */}
      {account.activated && (
        <section className="shell-people-section" aria-label={t("clients.title")}>
          <h2>{t("clients.title")}</h2>
          <EmptyState character="clients_empty" textKey="clients.empty" />
        </section>
      )}
      <section className="shell-people-section" aria-label={t("c.my_specialists")}>
        <h2>{t("c.my_specialists")}</h2>
        <EmptyState character="specialists_empty" textKey="c.no_specialists" />
      </section>
    </main>
  );
}
