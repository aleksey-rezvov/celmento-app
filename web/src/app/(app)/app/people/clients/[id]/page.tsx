"use client";

import { useParams, useRouter } from "next/navigation";
import { useState, type ReactElement } from "react";
import { ArchivedBanner } from "@/components/clients/ArchivedBanner";
import { BalanceBlock } from "@/components/clients/card/BalanceBlock";
import {
  ClientCardScreen,
  ClientScreen,
  archivedClientsPath,
  clientArchivePath,
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
import { apiClient, errorCode, type Schemas } from "@/lib/api/client";
import { useTranslation, type MessageKey } from "@/lib/i18n";
import { limitScreenHref } from "@/lib/limit";
import { getSessionToken } from "@/lib/session";

interface ClientCardViewProps {
  card: Schemas["ClientCard"];
  onChanged: (card: Schemas["ClientCard"]) => void;
}

function ClientCardView({ card, onChanged }: ClientCardViewProps): ReactElement {
  const { account, refresh } = useAccount();
  const router = useRouter();
  const navigate = useAppNavigation();
  const t = useTranslation();
  const [menu, setMenu] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState<MessageKey | null>(null);
  const active = card.status === "active";
  const edit = active ? clientPath(card.id) + "/edit" : null;
  const bookingUrl = account.leader?.booking_url ?? account.address_url;

  async function restore(): Promise<void> {
    if (active || restoring) return;

    const token = getSessionToken();
    setMenu(false);
    setRestoreError(null);
    setRestoring(true);
    try {
      const { data, error } = await apiClient(token).POST("/clients/{client_id}/restore", {
        params: { path: { client_id: card.id } },
      });
      if (getSessionToken() !== token) return;

      const code = errorCode(error);
      if (data || code === "client_not_archived") {
        await refresh();
        if (getSessionToken() === token) router.replace(clientsPath);
      } else if (code === "client_limit_reached") {
        // spec:impl client-archive-restore#open-limit-screen-restore-text
        navigate(limitScreenHref("restore", { clientId: card.id }));
      } else {
        setRestoreError("extra.auth_request_failed");
      }
    } catch {
      if (getSessionToken() === token) setRestoreError("extra.auth_network_error");
    } finally {
      setRestoring(false);
    }
  }

  return (
    <ClientScreen
      title={t("clients.title")}
      back={active ? clientsPath : archivedClientsPath}
      actions={
        <button
          className="shell-icon-button"
          type="button"
          aria-label={t("extra.client_actions")}
          onClick={() => setMenu(true)}
        >
          <span aria-hidden="true">…</span>
        </button>
      }
    >
      {!active && (
        <section className="client-archive-banner">
          {card.archived_at && <ArchivedBanner archivedAt={card.archived_at} />}
          <button
            type="button"
            className="shell-primary client-restore"
            disabled={restoring}
            onClick={() => void restore()}
          >
            {t("archive.restore")}
          </button>
          {restoreError && (
            <p role="alert" className="client-error">
              {t(restoreError)}
            </p>
          )}
        </section>
      )}
      <div className="client-card-detail" data-archived={!active}>
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
      {/* spec:impl client-card-view-edit#offer-three-dot-menu-screen-6-1 */}
      {menu && (
        <Sheet title={t("extra.client_actions")} onClose={() => setMenu(false)}>
          {edit ? (
            <div className="client-archive-actions">
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
              <button
                type="button"
                className="shell-secondary"
                onClick={() => {
                  setMenu(false);
                  // spec:impl client-archive-restore#open-confirmation-screen-5-4-titled
                  navigate(clientArchivePath(card.id));
                }}
              >
                {t("archive.action")}
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="shell-primary client-restore"
              disabled={restoring}
              onClick={() => void restore()}
            >
              {t("archive.restore")}
            </button>
          )}
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
