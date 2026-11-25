"use client";

import type { ReactElement } from "react";
import type { Schemas } from "@/lib/api/client";
import { useTranslation, type MessageKey } from "@/lib/i18n";
import { AddRow, PrivateTitle } from "./PrivateTextBlock";

type Card = Schemas["ClientCard"];

export const contactFields = {
  phone: { label: "profile.phone", channel: "phone" },
  email: { label: "extra.client_email", channel: "email" },
  telegram: { label: "card.telegram", channel: "telegram" },
  whatsapp: { label: "card.whatsapp", channel: "whatsapp" },
  other_contact: { label: "client.other_contact", channel: "other" },
} as const satisfies Record<
  "phone" | "email" | "telegram" | "whatsapp" | "other_contact",
  { label: MessageKey; channel: Schemas["ContactChannel"] }
>;

export const contactNames = ["phone", "email", "telegram", "whatsapp", "other_contact"] as const;
type ContactFields = Pick<Card, (typeof contactNames)[number]>;

export function availableContacts(card: ContactFields): (typeof contactNames)[number][] {
  return contactNames.filter((name) => Boolean(card[name]?.trim()));
}

interface ContactsBlockProps {
  card: Card;
  editHref: string | null;
}

export function ContactsBlock({ card, editHref }: ContactsBlockProps): ReactElement {
  const t = useTranslation();
  const filled = availableContacts(card);
  if (editHref && filled.length === 0) {
    return <AddRow href={editHref + "#contacts"} label="card.no_contacts" />;
  }

  const preferred = filled.find((name) => contactFields[name].channel === card.preferred_channel);

  return (
    // spec:impl client-card-view-edit#show-reference-contacts-block-titled
    <section className="client-block">
      <PrivateTitle title={t("client.contacts_title")} />
      <p className="client-hint">{t("client.contacts_hint")}</p>
      {filled.map((name) => (
        <p className="client-read-field" key={name}>
          <small>{t(contactFields[name].label)}</small>
          <span>{card[name]}</span>
        </p>
      ))}
      {preferred && (
        <p className="client-read-field">
          <small>{t("client.preferred_channel")}</small>
          <span>{t(contactFields[preferred].label)}</span>
        </p>
      )}
    </section>
  );
}
