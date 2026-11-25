"use client";

import Link from "next/link";
import { useEffect, useState, type ReactElement } from "react";
import { Character } from "@/components/Character";
import { ChoiceChips } from "@/components/shell/ChoiceChips";
import { EmptyState } from "@/components/shell/EmptyState";
import { useAccount } from "@/lib/account";
import { apiClient, type Schemas } from "@/lib/api/client";
import { useTranslation, type MessageKey } from "@/lib/i18n";
import { newClientHref } from "@/lib/limit";
import { getSessionToken } from "@/lib/session";
import { copyText, shareLink } from "@/lib/share";
import { ClientRow } from "./ClientRow";
import { ClientSearch } from "./ClientSearch";
import { LimitCounter } from "./LimitCounter";

type ClientStatus = Schemas["ClientCardStatus"];
type Plan = Schemas["PlanStatus"];

interface ClientsSectionProps {
  searchId: string;
  search: string | null;
  onSearch: (value: string) => void;
}

interface Result {
  key: string;
  data: Schemas["ClientList"];
  hasArchived: boolean;
}

function samePlan(left: Plan, right: Plan): boolean {
  return (
    left.kind === right.kind &&
    left.active_clients === right.active_clients &&
    left.client_limit === right.client_limit &&
    left.subscription_until === right.subscription_until
  );
}

export function ClientsSection({ searchId, search, onSearch }: ClientsSectionProps): ReactElement {
  const { account, refresh } = useAccount();
  const t = useTranslation();
  // spec:impl client-list#open-clients-section-active-clients
  const [status, setStatus] = useState<ClientStatus>("active");
  const [result, setResult] = useState<Result | null>(null);
  const [requestFailure, setRequestFailure] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [shareStatus, setShareStatus] = useState<MessageKey | null>(null);
  const query = search?.trim() || "";
  const key = `${account.id}:${query ? "search:" + query : status}`;
  const current = result?.key === key ? result : null;
  const failed = requestFailure === key;
  const leader = account.leader;
  const plan = current?.data.plan ?? leader?.plan;
  const createHref = newClientHref(plan);

  useEffect(() => {
    const token = getSessionToken();
    if (!token || !leader) return;

    const controller = new AbortController();
    const { signal } = controller;
    async function load(): Promise<void> {
      try {
        const api = apiClient(token);
        // spec:impl client-list#filter-clients-section-name-reference
        const { data } = await api.GET("/clients", {
          params: { query: query ? { q: query } : { status } },
          signal,
          cache: "no-store",
        });
        if (!data) throw new Error("Client list was unavailable.");

        let hasArchived = false;
        if (!query && status === "active" && data.items.length === 0 && !signal.aborted) {
          const { data: archive } = await api.GET("/clients", {
            params: { query: { status: "archived" } },
            signal,
            cache: "no-store",
          });
          if (!archive) throw new Error("Client archive was unavailable.");
          hasArchived = archive.items.length > 0;
        }

        if (signal.aborted || getSessionToken() !== token) return;
        setResult({ key, data, hasArchived });
        setRequestFailure(null);
        if (account.leader && !samePlan(account.leader.plan, data.plan)) {
          void refresh({ ...account, leader: { ...account.leader, plan: data.plan } });
        }
      } catch {
        if (!signal.aborted && getSessionToken() === token) setRequestFailure(key);
      }
    }

    const timer = window.setTimeout(() => void load(), query ? 160 : 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [account, attempt, key, leader, query, refresh, status]);

  async function shareBooking(action: "copy" | "share"): Promise<void> {
    if (!leader) return;

    setShareStatus(null);
    try {
      if (action === "copy") {
        await copyText(leader.booking_url);
        setShareStatus("profile.link_copied");
      } else {
        const nativeShare = typeof navigator.share === "function";
        await shareLink(leader.booking_url, leader.booking_url);
        if (!nativeShare) setShareStatus("profile.link_copied");
      }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        setShareStatus("extra.auth_request_failed");
      }
    }
  }

  return (
    <section className="shell-people-section clients-section" aria-label={t("clients.title")}>
      <h2>{t("clients.title")}</h2>
      {plan && <LimitCounter plan={plan} />}
      {search !== null && <ClientSearch id={searchId} value={search} onChange={onSearch} />}
      {!query && (
        <ChoiceChips
          label={t("clients.title")}
          value={status}
          onChange={setStatus}
          options={[
            { value: "active", label: t("clients.active") },
            { value: "archived", label: t("clients.archive") },
          ]}
        />
      )}

      {/* spec:impl client-list#open-client-creation-form-empty-add */}
      {failed ? (
        <div role="alert" className="clients-error">
          <p>{t("extra.auth_request_failed")}</p>
          <button
            className="shell-secondary"
            type="button"
            onClick={() => setAttempt((value) => value + 1)}
          >
            {t("extra.auth_retry")}
          </button>
        </div>
      ) : current === null ? (
        <div aria-busy="true" />
      ) : current.data.items.length > 0 ? (
        <ul className="clients-list">
          {current.data.items.map((item) => (
            <ClientRow key={item.id} item={item} searchResult={query !== ""} />
          ))}
        </ul>
      ) : query ? (
        /* spec:impl client-list#show-not-found-character-empty-add */
        <EmptyState
          character="clients_not_found"
          textKey="clients.not_found"
          action={{ labelKey: "clients.empty_add", href: createHref }}
        />
      ) : status === "archived" ? (
        <EmptyState character="clients_archive_empty" textKey="clients.archive_empty" />
      ) : current.hasArchived ? (
        <div className="clients-no-active">
          <p>{t("extra.clients_no_active")}</p>
          <Link className="shell-primary" href={createHref}>
            {t("clients.empty_add")}
          </Link>
        </div>
      ) : (
        /* spec:impl client-list#show-empty-state-clients-section */
        <div className="shell-empty clients-empty">
          <Character state="clients_empty" size={200} />
          <p>{t("clients.empty")}</p>
          <Link className="shell-primary" href={createHref}>
            {t("clients.empty_add")}
          </Link>
          <button
            className="shell-secondary"
            type="button"
            onClick={() => void shareBooking("copy")}
          >
            {t("clients.empty_copy_link")}
          </button>
          <button
            className="shell-secondary"
            type="button"
            onClick={() => void shareBooking("share")}
          >
            {t("client.invite")}
          </button>
          <p>{t("clients.empty_hint")}</p>
          {shareStatus && <p role="status">{t(shareStatus)}</p>}
        </div>
      )}
    </section>
  );
}
