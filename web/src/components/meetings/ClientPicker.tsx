"use client";

import { useEffect, useState, type ReactElement } from "react";
import { ClientAvatar } from "@/components/clients/ClientAvatar";
import { Sheet } from "@/components/shell/Sheet";
import { apiClient, type Schemas } from "@/lib/api/client";
import { useLanguage, useTranslation } from "@/lib/i18n";
import { getSessionToken } from "@/lib/session";

type Card = Schemas["ClientCard"];
type Row = Schemas["ClientListItem"];

interface ClientPickerProps {
  onClose: () => void;
  onPick: (card: Card) => void;
  onNewClient: () => void;
}

export function ClientPicker({ onClose, onPick, onNewClient }: ClientPickerProps): ReactElement {
  const t = useTranslation();
  const language = useLanguage();
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<Row[] | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const token = getSessionToken();

    async function load(): Promise<void> {
      try {
        const { data } = await apiClient(token).GET("/clients", {
          params: { query: { status: "active" } },
          signal: controller.signal,
          cache: "no-store",
        });
        if (controller.signal.aborted) return;
        if (data) setItems(data.items.filter(({ status }) => status === "active"));
        else setError(true);
      } catch {
        if (!controller.signal.aborted) setError(true);
      }
    }

    void load();
    return () => controller.abort();
  }, [attempt]);

  async function select(id: string): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(false);
    try {
      const { data } = await apiClient(getSessionToken()).GET("/clients/{client_id}", {
        params: { path: { client_id: id } },
        cache: "no-store",
      });
      if (data?.status === "active") onPick(data);
      else setError(true);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  // spec:impl meeting-form#list-client-picker-only-active
  const rows = (items ?? [])
    .filter(({ name }) =>
      name.toLocaleLowerCase(language).includes(query.trim().toLocaleLowerCase(language)),
    )
    .sort((left, right) => {
      const lhs = left.last_meeting_at;
      const rhs = right.last_meeting_at;
      if (lhs === null && rhs !== null) return 1;
      if (rhs === null && lhs !== null) return -1;
      if (lhs && rhs && Date.parse(lhs) !== Date.parse(rhs))
        return Date.parse(rhs) - Date.parse(lhs);
      return left.name.localeCompare(right.name, language);
    });

  return (
    <Sheet title={t("form.client")} onClose={() => !busy && onClose()}>
      <div className="meeting-picker">
        <button type="button" className="shell-primary" disabled={busy} onClick={onNewClient}>
          {t("form.new_client")}
        </button>
        <input
          type="search"
          aria-label={t("extra.client_search")}
          placeholder={t("extra.client_search")}
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
        {error && (
          <>
            <p role="alert">{t("extra.auth_request_failed")}</p>
            <button
              type="button"
              className="shell-secondary"
              onClick={() => {
                setError(false);
                setAttempt(attempt + 1);
              }}
            >
              {t("extra.auth_retry")}
            </button>
          </>
        )}
        {items === null && !error && <div aria-busy="true" />}
        {items !== null && !rows.length && <p className="meeting-hint">{t("clients.not_found")}</p>}
        <ul>
          {rows.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                disabled={busy}
                className="meeting-pick-row"
                onClick={() => void select(item.id)}
              >
                <ClientAvatar clientId={item.id} photoUrl={item.photo_url} name={item.name} />
                <span>{item.name}</span>
                <span aria-hidden="true">›</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </Sheet>
  );
}
