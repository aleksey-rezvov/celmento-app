"use client";

import { useParams } from "next/navigation";
import type { ReactElement } from "react";
import { PaymentForm, editablePayment } from "@/components/clients/PaymentForm";
import {
  ClientCardScreen,
  ClientScreen,
  clientPath,
} from "@/components/clients/card/ClientCardScreen";
import { useTranslation } from "@/lib/i18n";

export default function EditPaymentPage(): ReactElement {
  const { id, paymentId } = useParams<{ id: string; paymentId: string }>();
  const t = useTranslation();

  return (
    <ClientCardScreen clientId={id} includeHistory>
      {({ card, history }) => {
        const payment = history?.items.find(
          (operation) => operation.id === paymentId && editablePayment(card, operation),
        );
        // spec:impl client-balance-payments#allow-adding-editing-deleting-payment
        if (!history || !payment) {
          return (
            <ClientScreen title={t("payment.title")} back={clientPath(card.id) + "/balance"}>
              <p>{t("extra.auth_request_failed")}</p>
            </ClientScreen>
          );
        }

        // spec:impl client-balance-payments#open-payment-editing-payment-row
        return (
          <PaymentForm
            key={payment.id}
            card={card}
            currentBalance={history.balance.balance}
            payment={payment}
          />
        );
      }}
    </ClientCardScreen>
  );
}
