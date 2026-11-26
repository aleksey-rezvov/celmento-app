"use client";

import Link from "next/link";
import { useState, type ReactElement } from "react";
import { Sheet } from "@/components/shell/Sheet";
import { useAccount } from "@/lib/account";
import type { Schemas } from "@/lib/api/client";
import { formatDate, formatSessionCount } from "@/lib/format";
import { useLanguage, useTranslation } from "@/lib/i18n";
import { peoplePath } from "@/lib/limit";
import { ClientAvatar } from "./ClientAvatar";

type Balance = Schemas["BalanceSummary"];

interface BalanceBadgeProps {
  summary: Balance;
}

export function BalanceBadge({ summary }: BalanceBadgeProps): ReactElement | null {
  const t = useTranslation();
  const language = useLanguage();
  const amount = Number(summary.balance.amount);

  if (amount > 0 && summary.sessions_left !== null) {
    // spec:impl client-list#show-green-balance-plus-badge-number
    return (
      <span className="client-balance-badge client-balance-credit">
        {t("clients.balance_plus", { N: formatSessionCount(summary.sessions_left, language) })}
      </span>
    );
  }

  if (amount < 0 && summary.unpaid_sessions !== null) {
    // spec:impl client-list#show-red-balance-debt-badge-number
    return (
      <span className="client-balance-badge client-balance-debt">
        {t("clients.balance_debt", { N: formatSessionCount(summary.unpaid_sessions, language) })}
      </span>
    );
  }

  // spec:impl client-list#show-no-balance-badge-balance
  return null;
}

interface ClientRowProps {
  item: Schemas["ClientListItem"];
  searchResult?: boolean;
}

export function ClientRow({ item, searchResult = false }: ClientRowProps): ReactElement {
  const { account } = useAccount();
  const t = useTranslation();
  const [hint, setHint] = useState(false);
  const archived = item.status === "archived";
  const archivedDate = item.archived_at
    ? formatDate(item.archived_at, account.time_zone, account.language)
    : null;

  return (
    <li className="client-row" data-archived={archived}>
      <ClientAvatar clientId={item.id} name={item.name} photoUrl={item.photo_url} />
      <div className="client-row-content">
        <div className="client-row-title">
          {/* spec:impl client-list#open-client-card-row-tapped */}
          <Link
            className="client-row-link"
            href={`${peoplePath}/clients/${encodeURIComponent(item.id)}`}
          >
            {item.name}
          </Link>
          {/* spec:impl client-list#show-in-app-icon-row-client */}
          {item.linked && (
            <button
              type="button"
              className="client-row-link-info"
              aria-label={t("clients.in_app")}
              onClick={() => setHint(true)}
            >
              <svg
                viewBox="0 0 24 24"
                width="17"
                height="17"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <path d="M10 13.5a4 4 0 0 0 5.5 0l4-4a4 4 0 0 0-5.5-5.5L12 6m2 4.5a4 4 0 0 0-5.5 0l-4 4A4 4 0 0 0 10 20l2-2" />
              </svg>
            </button>
          )}
          {item.is_new && (
            <span className="client-row-tag client-row-new">{t("clients.new_badge")}</span>
          )}
          {archived && searchResult && (
            <span className="client-row-tag">{t("clients.in_archive")}</span>
          )}
        </div>
        <div className="client-row-detail">
          <span>{t("clients.sessions", { N: item.completed_sessions })}</span>
          <BalanceBadge summary={item.balance} />
        </div>
        {archivedDate && (
          <p className="client-row-detail">
            {t("clients.archived_on", { date: archivedDate, дата: archivedDate })}
          </p>
        )}
      </div>
      <span className="client-row-chevron" aria-hidden="true">
        ›
      </span>
      {hint && (
        <Sheet title={t("clients.in_app")} onClose={() => setHint(false)}>
          <p className="shell-sheet-text">{t("clients.in_app_hint")}</p>
        </Sheet>
      )}
    </li>
  );
}
