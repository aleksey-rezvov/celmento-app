import type { ReactElement } from "react";
import { ClientAvatar } from "@/components/clients/ClientAvatar";
import type { Schemas } from "@/lib/api/client";
import { useLanguage, useTranslation } from "@/lib/i18n";

interface ClientHeaderProps {
  card: Schemas["ClientCard"];
}

export function ClientHeader({ card }: ClientHeaderProps): ReactElement {
  const t = useTranslation();
  const language = useLanguage();
  const hours = new Intl.NumberFormat(language, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(card.completed_hours);

  return (
    <header className="client-identity">
      <ClientAvatar clientId={card.id} name={card.name} photoUrl={card.photo_url} size={112} />
      <div className="client-identity-name">
        <h2>{card.name}</h2>
        {card.linked && (
          <span
            className="client-linked-mark"
            role="img"
            aria-label={t("clients.in_app")}
            title={t("clients.in_app")}
          >
            <span aria-hidden="true">✓</span>
          </span>
        )}
        {card.is_new && <span className="client-badge">{t("clients.new_badge")}</span>}
      </div>
      <p className="client-hint">
        {t("client.sessions_hours", { N: card.completed_sessions, H: hours })}
      </p>
    </header>
  );
}
