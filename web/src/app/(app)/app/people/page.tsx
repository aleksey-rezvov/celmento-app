"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useId, useState, type ReactElement } from "react";
import { NoticeBar } from "@/components/NoticeBar";
import { ClientSearchToggle } from "@/components/clients/ClientSearch";
import { ClientsSection } from "@/components/clients/ClientsSection";
import { ScreenHeader } from "@/components/shell/ScreenHeader";
import { MySpecialists } from "@/components/specialists/MySpecialists";
import { unlinkSpecialist, useSpecialists } from "@/components/specialists/specialist-data";
import { useAccount } from "@/lib/account";
import { useTranslation } from "@/lib/i18n";
import "./clients.css";

function PeopleScreen(): ReactElement {
  const { account, currentSessionToken } = useAccount();
  const t = useTranslation();
  const [search, setSearch] = useState<string | null>(null);
  const searchId = useId();
  const specialists = useSpecialists();
  const initialStatus = useSearchParams().get("clients") === "archived" ? "archived" : "active";

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
      {/* spec:impl in-app-notice-bar#produce-bar-linked-notice-leader-name */}
      <NoticeBar
        tab="people"
        actions={{
          "client.linked_notice": async ({ params }) => {
            if (!params.specialist_id) throw new Error("No specialist for this notice.");
            await unlinkSpecialist(params.specialist_id, currentSessionToken);
            specialists.retry();
          },
        }}
        confirmations={{ "client.linked_notice": t("extra.specialist_unlink_warning") }}
      />
      {/* spec:impl mobile-app-shell#show-people-tab-leader-clients */}
      {/* spec:impl client-leading-activation#show-non-leader-people-tab-only-specialists */}
      {/* spec:impl client-list#show-clients-section-titled-people */}
      {account.activated && (
        <ClientsSection
          key={initialStatus}
          initialStatus={initialStatus}
          searchId={searchId}
          search={search}
          onSearch={setSearch}
        />
      )}
      <MySpecialists resource={specialists} />
    </main>
  );
}

export default function People(): ReactElement {
  return (
    <Suspense fallback={<main aria-busy="true" />}>
      <PeopleScreen />
    </Suspense>
  );
}
