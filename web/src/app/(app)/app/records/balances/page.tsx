"use client";

import Link from "next/link";
import type { ReactElement } from "react";
import { ClientAvatar } from "@/components/clients/ClientAvatar";
import { BalanceBadge } from "@/components/clients/ClientRow";
import { clientPath } from "@/components/clients/card/ClientCardScreen";
import { RecordsLoadState, RecordsScreen } from "@/components/records/RecordsScreen";
import { useRecordsBalances } from "@/components/records/records-data";
import { formatMoney } from "@/lib/format";
import { useLanguage, useTranslation } from "@/lib/i18n";

export default function BalancesPage(): ReactElement {
  const t = useTranslation();
  const language = useLanguage();
  const { data, error, retry } = useRecordsBalances();

  // spec:impl accounting-summary#open-prepaid-debts-tile-screen-title
  return (
    <RecordsScreen title="balances.title" showPeriod={false}>
      {data ? (
        data.items.length > 0 ? (
          <ul className="clients-list">
            {data.items.map(({ client, balance }) => (
              // spec:impl accounting-summary#show-row-balances-list-client
              <li className="client-row" data-archived={client.archived} key={client.id}>
                <ClientAvatar clientId={client.id} name={client.name} photoUrl={client.photo_url} />
                <div>
                  <Link className="client-row-title client-row-link" href={clientPath(client.id)}>
                    {client.name}
                  </Link>
                  <div className="client-row-detail">
                    <span>{formatMoney(balance.balance, language)}</span>
                    <BalanceBadge summary={balance} />
                  </div>
                </div>
                <span className="client-row-chevron" aria-hidden="true">
                  ›
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="records-list-state">{t("extra.records_no_balances")}</p>
        )
      ) : (
        <RecordsLoadState error={error} retry={retry} />
      )}
    </RecordsScreen>
  );
}
