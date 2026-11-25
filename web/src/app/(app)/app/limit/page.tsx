"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, type ReactElement } from "react";
import { Character } from "@/components/Character";
import { clientPath } from "@/components/clients/card/ClientCardScreen";
import { useAccount } from "@/lib/account";
import { apiClient, type Schemas } from "@/lib/api/client";
import { useTranslation, type MessageKey } from "@/lib/i18n";
import { limitReturnPath, peoplePath } from "@/lib/limit";
import { getSessionToken } from "@/lib/session";

const uuid = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/iu;
type LookupResult =
  | { key: string; card: Pick<Schemas["ClientCard"], "id" | "name"> }
  | { key: string; error: MessageKey };

function LimitMessage(): ReactElement {
  const query = useSearchParams();
  const { account } = useAccount();
  const t = useTranslation();
  const [attempt, setAttempt] = useState(0);
  const [lookup, setLookup] = useState<LookupResult | null>(null);
  const restore = query.get("reason") === "restore";
  const target = query.get("client_id");
  const clientId = restore && account.activated && target && uuid.test(target) ? target : null;
  const key = clientId ? [account.id, clientId, attempt].join(":") : null;
  const result = lookup?.key === key ? lookup : null;
  const card = result && "card" in result ? result.card : null;
  const error =
    restore && !clientId ? "clients.not_found" : result && "error" in result ? result.error : null;
  const back = restore
    ? card
      ? clientPath(card.id)
      : peoplePath
    : limitReturnPath(query.get("returnTo"));
  // spec:impl free-plan-client-limit#show-new-client-screen-10-1-card
  const message = restore
    ? card && t("limit.restore", { name: card.name, имя: card.name })
    : t("limit.new_client");

  useEffect(() => {
    if (!clientId || !key) return;

    const controller = new AbortController();
    const { signal } = controller;
    const token = getSessionToken();

    async function load(clientId: string, key: string): Promise<void> {
      try {
        const { data, response } = await apiClient(token).GET("/clients/{client_id}", {
          params: { path: { client_id: clientId } },
          signal,
          cache: "no-store",
        });
        if (signal.aborted || getSessionToken() !== token) return;

        if (data) {
          setLookup({ key, card: { id: data.id, name: data.name } });
        } else {
          const missing = [403, 404, 422].includes(response.status);
          setLookup({ key, error: missing ? "clients.not_found" : "extra.auth_request_failed" });
        }
      } catch {
        if (!signal.aborted && getSessionToken() === token) {
          setLookup({ key, error: "extra.auth_network_error" });
        }
      }
    }

    void load(clientId, key);
    return () => controller.abort();
  }, [clientId, key]);

  return (
    <main className="grid gap-4">
      {/* spec:impl free-plan-client-limit#return-screen-action-started-people */}
      <Link className="shell-icon-button" href={back} aria-label={t("extra.back")}>
        <span aria-hidden="true">←</span>
      </Link>
      {/* spec:impl character-illustrations#show-celmento-master-blue-celmento-master-red */}
      <Character state="plan_limit_pair" size={172} />
      <section className="grid justify-items-start gap-4 rounded-3xl bg-white p-5">
        {message && (
          <h1 className="text-2xl leading-tight font-bold [font-family:var(--font-title)]">
            {message}
          </h1>
        )}
        {error ? (
          <>
            <p role="alert">{t(error)}</p>
            {error !== "clients.not_found" && (
              <button
                className="shell-secondary"
                type="button"
                onClick={() => setAttempt((value) => value + 1)}
              >
                {t("extra.auth_retry")}
              </button>
            )}
          </>
        ) : (
          message === null && <div aria-busy="true" />
        )}
        <Link className="shell-secondary" href={peoplePath}>
          {t("limit.open_clients")}
        </Link>
        <p className="text-sm text-[var(--color-secondary)]">{t("limit.history_kept")}</p>
      </section>
    </main>
  );
}

export default function Limit(): ReactElement {
  return (
    <Suspense fallback={<main aria-busy="true" />}>
      <LimitMessage />
    </Suspense>
  );
}
