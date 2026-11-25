"use client";

import type { ReactElement } from "react";
import { ContactButtons } from "@/components/ContactButtons";
import { useAppNavigation } from "@/components/shell/navigation";
import { useAccount } from "@/lib/account";
import type { Schemas } from "@/lib/api/client";
import { formatDate } from "@/lib/format";
import { useLanguage, useTranslation } from "@/lib/i18n";
import { availableContacts } from "./ContactsBlock";

interface QuickActionsProps {
  card: Schemas["ClientCard"];
}

export function QuickActions({ card }: QuickActionsProps): ReactElement {
  const { account } = useAccount();
  const navigate = useAppNavigation();
  const t = useTranslation();
  const language = useLanguage();
  const active = card.status === "active";
  const noteDate = formatDate(new Date().toISOString(), account.time_zone, language);

  return (
    <div className="client-quick-wrap">
      {/* spec:impl client-card-view-edit#show-quick-actions-order-book */}
      <div className="client-quick-actions">
        {active && (
          <button
            className="client-quick-action"
            type="button"
            onClick={() => navigate("/app/meetings/new?client_id=" + encodeURIComponent(card.id))}
          >
            <span className="client-quick-icon" aria-hidden="true">
              ＋
            </span>
            <span>{t("client.book")}</span>
          </button>
        )}
        <ContactButtons contacts={card} preferred={card.preferred_channel} />
        {active && (
          <button
            className="client-quick-action"
            type="button"
            onClick={() =>
              navigate(
                "/app/notes/new?first_line=" + encodeURIComponent(card.name + ", " + noteDate),
              )
            }
          >
            <span className="client-quick-icon" aria-hidden="true">
              ✎
            </span>
            <span>{t("client.note")}</span>
          </button>
        )}
      </div>
      {/* spec:impl client-card-view-edit#show-only-book-note-quick */}
      {active && availableContacts(card).length === 0 && (
        <p className="client-hint">{t("client.no_contacts_hint")}</p>
      )}
    </div>
  );
}
