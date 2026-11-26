"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, type ReactElement } from "react";
import { Character } from "@/components/Character";
import { clientPath } from "@/components/clients/card/ClientCardScreen";
import { LeaderPlansGate } from "@/components/plans/LeaderPlansGate";
import {
  useApplyPlanStatus,
  useLimitConfirmation,
  useLivePlan,
} from "@/components/plans/plans-data";
import { fromLimitHref } from "@/components/plans/plans-paths";
import { useAccount } from "@/lib/account";
import { apiClient, type Schemas } from "@/lib/api/client";
import { useTranslation, type MessageKey } from "@/lib/i18n";
import {
  activeClientLimitReached,
  limitReturnPath,
  limitScreenHref,
  newClientPath,
  peoplePath,
} from "@/lib/limit";
import "../plans/plans.css";

const uuid = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/iu;
type Card = Pick<Schemas["ClientCard"], "id" | "name" | "status">;
type CardLookup = { key: string; card: Card } | { key: string; error: MessageKey };

interface LimitMessageProps {
  restore: boolean;
  target: string | null;
  returnTo: string;
}

function resumeCreation(back: string): string {
  const { pathname } = new URL(back, "https://celmento.invalid");
  return /^\/app\/meetings\/(new|[^/]+\/edit)$/u.test(pathname) ? back : newClientPath;
}

function LimitMessage({ restore, target, returnTo }: LimitMessageProps): ReactElement {
  const { account, currentSessionToken } = useAccount();
  const router = useRouter();
  const t = useTranslation();
  const [attempt, setAttempt] = useState(0);
  const [lookup, setLookup] = useState<CardLookup | null>(null);
  const clientId = restore && target && uuid.test(target) ? target : null;
  const key = clientId ? [account.id, clientId, attempt].join(":") : null;
  const result = lookup?.key === key ? lookup : null;
  const card = result && "card" in result ? result.card : null;
  const confirmation = useLimitConfirmation(!restore || card?.status === "archived");
  const plan = confirmation?.data ?? null;
  const applied = useApplyPlanStatus(plan);
  const livePlan = account.leader?.plan;
  const capped = applied && livePlan !== undefined && activeClientLimitReached(livePlan);
  useLivePlan(capped);
  const cardError =
    restore && !clientId ? "clients.not_found" : result && "error" in result ? result.error : null;
  const error = cardError ?? confirmation?.error ?? null;
  const back = restore ? (card ? clientPath(card.id) : peoplePath) : returnTo;
  const retryTo = restore ? back : resumeCreation(back);
  const limitHref =
    restore && clientId
      ? limitScreenHref("restore", { clientId })
      : limitScreenHref("new_client", { returnTo });

  useEffect(() => {
    const session = currentSessionToken();
    if (!clientId || !key || !session) return;
    const controller = new AbortController();
    const { signal } = controller;

    async function load(token: string, clientId: string, key: string): Promise<void> {
      try {
        const { data, response } = await apiClient(token).GET("/clients/{client_id}", {
          params: { path: { client_id: clientId } },
          signal,
          cache: "no-store",
        });
        if (signal.aborted || currentSessionToken() !== token) return;

        if (data) {
          setLookup({ key, card: { id: data.id, name: data.name, status: data.status } });
        } else {
          const missing = [403, 404, 422].includes(response.status);
          setLookup({ key, error: missing ? "clients.not_found" : "extra.auth_request_failed" });
        }
      } catch {
        if (!signal.aborted && currentSessionToken() === token) {
          setLookup({ key, error: "extra.auth_network_error" });
        }
      }
    }

    void load(session, clientId, key);
    return () => controller.abort();
  }, [clientId, currentSessionToken, key]);

  useEffect(() => {
    // spec:impl free-plan-client-limit#make-creating-restoring-new-client
    if (currentSessionToken() && (card?.status === "active" || (applied && !capped))) {
      router.replace(retryTo);
    }
  }, [applied, capped, card?.status, currentSessionToken, retryTo, router]);

  // spec:impl free-plan-client-limit#show-new-client-screen-10-1-card
  const message = restore
    ? card && t("limit.restore", { name: card.name, имя: card.name })
    : t("limit.new_client");

  return (
    <main className="plans-page plans-outcome">
      {/* spec:impl free-plan-client-limit#return-screen-action-started-people */}
      {/* spec:impl free-plan-client-limit#return-meeting-form-entered-value */}
      <Link className="shell-icon-button" href={back} aria-label={t("extra.back")}>
        <span aria-hidden="true">‹</span>
      </Link>
      {/* spec:impl free-plan-client-limit#open-screen-10-1-thoughtful-character */}
      {/* spec:impl character-illustrations#show-celmento-master-blue-celmento-master-red */}
      {capped && <Character state="plan_limit_pair" size={172} />}
      {error ? (
        <section className="plans-card">
          <p role="alert">{t(error)}</p>
          {cardError && cardError !== "clients.not_found" && (
            <button
              className="shell-secondary"
              type="button"
              onClick={() => setAttempt((previous) => previous + 1)}
            >
              {t("extra.auth_retry")}
            </button>
          )}
          <Link className="shell-secondary" href={peoplePath}>
            {t("limit.open_clients")}
          </Link>
        </section>
      ) : capped ? (
        <section className="plans-card">
          <h1>{message}</h1>
          {/* spec:impl free-plan-client-limit#show-buttons-open-clients-opening-active */}
          {/* spec:impl subscription-plans-request#open-screen-10-2-titled-plans */}
          <Link className="shell-primary" href={fromLimitHref(limitHref)}>
            {t("limit.plans")}
          </Link>
          <Link className="shell-secondary" href={peoplePath}>
            {t("limit.open_clients")}
          </Link>
          {/* spec:impl free-plan-client-limit#show-history-kept-buttons-screen-10-1 */}
          <p className="plans-hint">{t("limit.history_kept")}</p>
        </section>
      ) : (
        <div className="plans-loading" aria-busy="true" />
      )}
    </main>
  );
}

function RequestedLimit(): ReactElement {
  const query = useSearchParams();

  return (
    <LimitMessage
      key={query.toString()}
      restore={query.get("reason") === "restore"}
      target={query.get("client_id")}
      returnTo={limitReturnPath(query.get("returnTo"))}
    />
  );
}

export default function Limit(): ReactElement {
  return (
    <LeaderPlansGate>
      <Suspense fallback={<main aria-busy="true" />}>
        <RequestedLimit />
      </Suspense>
    </LeaderPlansGate>
  );
}
