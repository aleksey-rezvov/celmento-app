"use client";

import type { ReactElement } from "react";
import type { Schemas } from "@/lib/api/client";
import { useTranslation, type MessageKey } from "@/lib/i18n";

interface ContactButtonsProps {
  contacts: {
    phone: string | null;
    telegram: string | null;
    whatsapp: string | null;
    email: string | null;
  };
  preferred: Schemas["ContactChannel"] | null;
}

type Channel = keyof ContactButtonsProps["contacts"];
const channels: readonly Channel[] = ["phone", "telegram", "whatsapp", "email"];
const visuals = {
  phone: { label: "card.call", icon: "☎" },
  telegram: { label: "card.telegram", icon: "➤" },
  whatsapp: { label: "card.whatsapp", icon: "◉" },
  email: { label: "card.email", icon: "✉" },
} satisfies Record<Channel, { label: MessageKey; icon: string }>;

function contactHref(channel: Channel, reference: string): string {
  switch (channel) {
    case "phone":
      return "tel:" + encodeURIComponent(reference).replace(/^%2B/u, "+");
    case "email":
      return "mailto:" + encodeURIComponent(reference).replaceAll("%40", "@");
    case "telegram": {
      const name = reference.replace(/^(?:(?:https?:\/\/)?(?:t\.me|telegram\.me)\/|@)/iu, "");
      return "https://t.me/" + encodeURIComponent(name);
    }
    case "whatsapp":
      return "https://wa.me/" + reference.replace(/[^0-9]/gu, "");
  }
}

export function ContactButtons({ contacts, preferred }: ContactButtonsProps): ReactElement {
  const t = useTranslation();
  const order =
    preferred && channels.some((channel) => channel === preferred)
      ? [
          ...channels.filter((channel) => channel === preferred),
          ...channels.filter((channel) => channel !== preferred),
        ]
      : channels;

  return (
    <>
      {order.map((channel) => {
        const reference = contacts[channel]?.trim();
        if (!reference) return null;
        const { label, icon } = visuals[channel];
        return (
          // spec:impl client-card-view-edit#open-phone-dialer-telegram-whatsapp
          <a key={channel} className="client-quick-action" href={contactHref(channel, reference)}>
            <span className="client-quick-icon" aria-hidden="true">
              {icon}
            </span>
            <span>{t(label)}</span>
          </a>
        );
      })}
    </>
  );
}
