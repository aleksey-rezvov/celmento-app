"use client";

import type { ReactElement } from "react";
import { useAppNavigation } from "@/components/shell/navigation";
import type { Schemas } from "@/lib/api/client";
import { formatMoney, formatSessionCount } from "@/lib/format";
import { useLanguage, useTranslation } from "@/lib/i18n";
import { clientPath } from "./ClientCardScreen";
import { cents } from "./card-money";

interface BalanceBlockProps {
  card: Schemas["ClientCard"];
}

export function BalanceBlock({ card }: BalanceBlockProps): ReactElement {
  const t = useTranslation();
  const language = useLanguage();
  const navigate = useAppNavigation();
  const href = clientPath(card.id);
  const active = card.status === "active";
  const paid = card.payment_type === "paid";
  const { balance, sessions_left, unpaid_sessions } = card.balance;
  const amount = formatMoney(balance, language);
  const units = cents(balance.amount);
  const rate = card.rate;

  return (
    // spec:impl client-balance-payments#show-balance-block-screen-6-1
    <section className="client-block client-balance">
      <h2>{t("client.balance")}</h2>
      <div className="client-inline">
        {(paid || units !== 0n) && (
          <strong
            className={units < 0n ? "client-balance-amount client-debit" : "client-balance-amount"}
          >
            {amount}
          </strong>
        )}
        {!paid ? (
          // spec:impl client-balance-payments#show-free-pro-bono-payment-type
          <span className="client-badge">
            {t(card.payment_type === "barter" ? "client.barter" : "client.free")}
          </span>
        ) : rate === null ? null : unpaid_sessions !== null ? (
          <span className="client-badge client-badge-debit">
            {t("client.balance_debt", { N: formatSessionCount(unpaid_sessions, language) })}
          </span>
        ) : sessions_left !== null ? (
          <span className="client-badge client-badge-credit">
            {t("client.balance_left", { N: formatSessionCount(sessions_left, language) })}
          </span>
        ) : null}
      </div>
      {rate === null ? (
        // spec:impl client-balance-payments#show-rate-not-set-set-rate-link-opens
        <p className="client-hint">
          {t("client.rate_not_set")}
          {active && (
            <>
              {" "}
              <button
                className="client-text-button"
                type="button"
                onClick={() => navigate(href + "/edit#rate")}
              >
                {t("extra.set_rate")}
              </button>
            </>
          )}
        </p>
      ) : (
        // spec:impl client-rate-currency#show-rate-client-currency-balance
        <p className="client-hint">
          {t("client.rate", {
            [language === "ru" ? "сумма" : "amount"]: formatMoney(
              { amount: rate, currency: card.currency },
              language,
            ),
          })}
        </p>
      )}
      <div className="client-inline">
        {active && paid && (
          <button
            className="shell-primary"
            type="button"
            onClick={() => navigate(href + "/payments/new")}
          >
            {t("client.add_payment")}
          </button>
        )}
        <button
          className="shell-secondary"
          type="button"
          onClick={() => navigate(href + "/balance")}
        >
          {t("client.history")}
        </button>
      </div>
    </section>
  );
}
