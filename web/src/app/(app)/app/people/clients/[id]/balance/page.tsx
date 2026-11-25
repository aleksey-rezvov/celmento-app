"use client";

import { useParams } from "next/navigation";
import type { ReactElement } from "react";
import { editablePayment } from "@/components/clients/PaymentForm";
import {
  ClientCardScreen,
  ClientScreen,
  clientPath,
} from "@/components/clients/card/ClientCardScreen";
import { cents } from "@/components/clients/card/card-money";
import { useAppNavigation } from "@/components/shell/navigation";
import type { Schemas } from "@/lib/api/client";
import { formatDate, formatMoney } from "@/lib/format";
import { useLanguage, useTranslation, type MessageKey } from "@/lib/i18n";

const operationNames = {
  payment: "op.payment",
  session_charge: "op.session",
  missed_charge: "op.missed",
  refund_to_balance: "op.return",
  deleted_meeting_charge: "op.deleted_charge",
  correction: "op.correction",
} as const satisfies Record<Schemas["BalanceOperationKind"], MessageKey>;

interface HistoryProps {
  card: Schemas["ClientCard"];
  history: Schemas["ClientBalance"];
}

function BalanceHistory({ card, history }: HistoryProps): ReactElement {
  const t = useTranslation();
  const language = useLanguage();
  const navigate = useAppNavigation();
  const href = clientPath(card.id);

  return (
    <ClientScreen title={t("client.history")} back={href}>
      <section className="client-history-summary">
        <span>{t("client.balance")}</span>
        <strong>{formatMoney(history.balance.balance, language)}</strong>
      </section>
      {/* spec:impl client-balance-payments#open-screen-6-4-history-listing */}
      {history.items.length ? (
        <ul className="client-history">
          {history.items.map((operation) => {
            const amount = cents(operation.amount.amount);
            const sign = amount > 0n ? "+" : "";
            const date = formatDate(operation.date, "UTC", language);
            const description = t(operationNames[operation.kind], {
              [language === "ru" ? "дата" : "date"]: date,
            });
            // spec:impl client-balance-payments#allow-editing-deleting-payment-recorded
            const target = editablePayment(card, operation)
              ? href + "/payments/" + encodeURIComponent(operation.id)
              : operation.meeting_id
                ? "/app/meetings/" + encodeURIComponent(operation.meeting_id)
                : null;
            const row = (
              <>
                <div className="client-history-copy">
                  <strong>{description}</strong>
                  {operation.kind === "payment" && <time dateTime={operation.date}>{date}</time>}
                  {operation.comment && <p>{operation.comment}</p>}
                </div>
                <span
                  className={
                    amount < 0n ? "client-debit" : amount > 0n ? "client-credit" : undefined
                  }
                >
                  {sign}
                  {formatMoney(operation.amount, language)}
                </span>
              </>
            );
            return (
              <li key={operation.id}>
                {target ? (
                  <button
                    type="button"
                    className="client-history-row"
                    onClick={() => navigate(target)}
                  >
                    {row}
                    <span aria-hidden="true">›</span>
                  </button>
                ) : (
                  <div className="client-history-row">{row}</div>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="client-hint">{t("extra.client_history_empty")}</p>
      )}
    </ClientScreen>
  );
}

export default function ClientBalancePage(): ReactElement {
  const { id } = useParams<{ id: string }>();
  const t = useTranslation();
  return (
    <ClientCardScreen clientId={id} includeHistory>
      {({ card, history }) =>
        history ? (
          <BalanceHistory card={card} history={history} />
        ) : (
          <ClientScreen title={t("client.history")} back={clientPath(card.id)}>
            <p>{t("extra.auth_request_failed")}</p>
          </ClientScreen>
        )
      }
    </ClientCardScreen>
  );
}
