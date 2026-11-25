"use client";

import { useParams } from "next/navigation";
import { useState, type ReactElement } from "react";
import { BalanceBlock } from "@/components/clients/card/BalanceBlock";
import {
  ClientCardScreen,
  ClientScreen,
  clientPath,
  clientsPath,
} from "@/components/clients/card/ClientCardScreen";
import { ClientHeader } from "@/components/clients/card/ClientHeader";
import { ContactsBlock } from "@/components/clients/card/ContactsBlock";
import { LinkBlock } from "@/components/clients/card/LinkBlock";
import { MeetingsBlock } from "@/components/clients/card/MeetingsBlock";
import { PrivateTextBlock } from "@/components/clients/card/PrivateTextBlock";
import { QuickActions } from "@/components/clients/card/QuickActions";
import { Sheet } from "@/components/shell/Sheet";
import { useAppNavigation } from "@/components/shell/navigation";
import { useAccount } from "@/lib/account";
import type { Schemas } from "@/lib/api/client";
import { formatDate } from "@/lib/format";
import { useLanguage, useTranslation } from "@/lib/i18n";

interface ClientCardViewProps {
  card: Schemas["ClientCard"];
  onChanged: (card: Schemas["ClientCard"]) => void;
}

function ClientCardView({ card, onChanged }: ClientCardViewProps): ReactElement {
  const { account } = useAccount();
  const navigate = useAppNavigation();
  const t = useTranslation();
  const language = useLanguage();
  const [menu, setMenu] = useState(false);
  const active = card.status === "active";
  const edit = active ? clientPath(card.id) + "/edit" : null;
  const bookingUrl = account.leader?.booking_url ?? account.address_url;

  return (
    <ClientScreen
      title={t("clients.title")}
      back={clientsPath}
      actions={
        edit && (
          <button
            className="shell-icon-button"
            type="button"
            aria-label={t("extra.client_actions")}
            onClick={() => setMenu(true)}
          >
            <span aria-hidden="true">…</span>
          </button>
        )
      }
    >
      {card.archived_at && (
        <p className="client-archived">
          {t("client.archived_banner", {
            [language === "ru" ? "дата" : "date"]: formatDate(
              card.archived_at,
              account.time_zone,
              language,
            ),
          })}
        </p>
      )}
      <div className="client-card-detail">
        <ClientHeader card={card} />
        <QuickActions card={card} />
        <BalanceBlock card={card} />
        <MeetingsBlock clientId={card.id} />
        <ContactsBlock card={card} editHref={edit} />
        <LinkBlock card={card} bookingUrl={bookingUrl} onChanged={onChanged} />
        <PrivateTextBlock
          title="extra.client_request_goals"
          addLabel="extra.client_add_request_goals"
          editHref={edit && edit + "#request"}
          fields={[
            { label: "client.request", value: card.request },
            { label: "client.goals", value: card.goals },
          ]}
        />
        <PrivateTextBlock
          title="client.info"
          addLabel="extra.client_add_info"
          editHref={edit && edit + "#info"}
          fields={[{ label: "client.info", value: card.info }]}
        />
        <PrivateTextBlock
          title="client.hypotheses"
          addLabel="extra.client_add_hypotheses"
          editHref={edit && edit + "#hypotheses"}
          fields={[{ label: "client.hypotheses", value: card.hypotheses }]}
        />
      </div>
      {menu && edit && (
        <Sheet title={t("extra.client_actions")} onClose={() => setMenu(false)}>
          <button
            type="button"
            className="shell-primary"
            onClick={() => {
              setMenu(false);
              navigate(edit);
            }}
          >
            {t("card.edit")}
          </button>
        </Sheet>
      )}
    </ClientScreen>
  );
}

export default function ClientCardPage(): ReactElement {
  const { id } = useParams<{ id: string }>();
  return (
    <ClientCardScreen clientId={id}>
      {({ card, setCard }) => <ClientCardView key={card.id} card={card} onChanged={setCard} />}
    </ClientCardScreen>
  );
}
