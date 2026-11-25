"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState, type ReactElement } from "react";
import { Character } from "@/components/Character";
import { ArchiveMeetingTime, OutcomesFirstBlock } from "@/components/clients/OutcomesFirstBlock";
import {
  ClientCardScreen,
  ClientScreen,
  clientPath,
} from "@/components/clients/card/ClientCardScreen";
import { useAppNavigation } from "@/components/shell/navigation";
import { useAccount } from "@/lib/account";
import { apiClient, errorCode, type Schemas } from "@/lib/api/client";
import { formatMoney } from "@/lib/format";
import { useLanguage, useTranslation, type MessageKey } from "@/lib/i18n";
import { getSessionToken } from "@/lib/session";

type Preview = Schemas["ClientArchivePreview"];
type PreviewResult = { attempt: number; data: Preview } | { attempt: number; error: MessageKey };

function ArchiveConfirmation({ card }: { card: Schemas["ClientCard"] }): ReactElement {
  const router = useRouter();
  const navigate = useAppNavigation();
  const { refresh } = useAccount();
  const t = useTranslation();
  const language = useLanguage();
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<PreviewResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  const id = card.id;
  const active = card.status === "active";
  const back = clientPath(id);
  const current = result?.attempt === attempt ? result : null;
  const preview = current && "data" in current ? current.data : null;
  const amount =
    preview && Number(preview.balance.amount) !== 0 ? formatMoney(preview.balance, language) : null;

  useEffect(() => {
    if (!active) {
      router.replace(back);
      return;
    }

    const controller = new AbortController();
    const { signal } = controller;
    const token = getSessionToken();

    async function load(): Promise<void> {
      try {
        const { data } = await apiClient(token).GET("/clients/{client_id}/archive-preview", {
          params: { path: { client_id: id } },
          signal,
          cache: "no-store",
        });
        if (signal.aborted || getSessionToken() !== token) return;
        setResult(data ? { attempt, data } : { attempt, error: "extra.auth_request_failed" });
      } catch {
        if (!signal.aborted && getSessionToken() === token) {
          setResult({ attempt, error: "extra.auth_network_error" });
        }
      }
    }

    void load();
    return () => controller.abort();
  }, [active, attempt, back, id, router]);

  async function archive(): Promise<void> {
    if (!active || busy || !preview || preview.meetings_awaiting_outcome.length > 0) return;

    const token = getSessionToken();
    setError(null);
    setBusy(true);
    try {
      const { data, error } = await apiClient(token).POST("/clients/{client_id}/archive", {
        params: { path: { client_id: id } },
        body: { preview_token: preview.preview_token },
      });
      if (getSessionToken() !== token) return;

      const code = errorCode(error);
      if (data || code === "client_archived") {
        await refresh();
        if (getSessionToken() === token) router.replace(back);
      } else if (code === "outcomes_pending" || code === "conflict") {
        if (code === "conflict") setError("extra.archive_preview_changed");
        setAttempt((value) => value + 1);
      } else {
        setError("extra.auth_request_failed");
      }
    } catch {
      if (getSessionToken() === token) setError("extra.auth_network_error");
    } finally {
      setBusy(false);
    }
  }

  if (!active) return <div aria-busy="true" />;

  return (
    <ClientScreen title={t("archive.title", { name: card.name, имя: card.name })} back={back}>
      <Character state="clients_archive_confirm" size={172} />
      <div className="client-archive-panel">
        {current === null ? (
          <div aria-busy="true" />
        ) : "error" in current ? (
          <div className="client-archive-status">
            <p role="alert" className="client-error">
              {t(current.error)}
            </p>
            <button
              className="shell-secondary"
              type="button"
              onClick={() => setAttempt((value) => value + 1)}
            >
              {t("extra.auth_retry")}
            </button>
          </div>
        ) : (
          <>
            <OutcomesFirstBlock meetings={current.data.meetings_awaiting_outcome} />
            {/* spec:impl client-archive-restore#list-screen-5-4-planned-client */}
            {current.data.meetings_to_delete.length > 0 ? (
              <section className="client-archive-planned">
                <h2>{t("archive.planned")}</h2>
                <ul>
                  {current.data.meetings_to_delete.map((meeting) => (
                    <li key={meeting.id}>
                      <ArchiveMeetingTime startsAt={meeting.starts_at} />
                    </li>
                  ))}
                </ul>
              </section>
            ) : (
              <p>{t("archive.no_planned")}</p>
            )}
            {/* spec:impl client-archive-restore#show-balance-client-currency-screen */}
            {amount && <p>{t("archive.balance", { amount, сумма: amount })}</p>}
          </>
        )}
        {/* spec:impl client-archive-restore#show-keep-history-buttons-confirm-cancel */}
        <p className="client-hint">{t("archive.keep_history")}</p>
        {error && (
          <p role="alert" className="client-error">
            {t(error)}
          </p>
        )}
        <div className="client-archive-actions">
          {/* spec:impl client-archive-restore#keep-confirm-disabled-outcomes-first */}
          <button
            className="shell-primary"
            type="button"
            disabled={!preview || preview.meetings_awaiting_outcome.length > 0 || busy}
            onClick={() => void archive()}
          >
            {t("archive.confirm")}
          </button>
          <button
            className="shell-secondary"
            type="button"
            disabled={busy}
            onClick={() => navigate(back)}
          >
            {t("archive.cancel")}
          </button>
        </div>
      </div>
    </ClientScreen>
  );
}

export default function ClientArchivePage(): ReactElement {
  const { id } = useParams<{ id: string }>();
  return (
    <ClientCardScreen clientId={id}>
      {({ card }) => <ArchiveConfirmation key={card.id} card={card} />}
    </ClientCardScreen>
  );
}
