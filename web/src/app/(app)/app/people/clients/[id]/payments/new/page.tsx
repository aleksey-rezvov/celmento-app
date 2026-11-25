"use client";

import { useParams } from "next/navigation";
import type { ReactElement } from "react";
import { PaymentForm } from "@/components/clients/PaymentForm";
import { ClientCardScreen } from "@/components/clients/card/ClientCardScreen";

export default function NewPaymentPage(): ReactElement {
  const { id } = useParams<{ id: string }>();
  return (
    <ClientCardScreen clientId={id}>
      {({ card }) => (
        <PaymentForm key={card.id} card={card} currentBalance={card.balance.balance} />
      )}
    </ClientCardScreen>
  );
}
