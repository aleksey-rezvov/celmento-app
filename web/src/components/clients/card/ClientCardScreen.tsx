"use client";

import { useEffect, useState, type ReactElement, type ReactNode } from "react";
import { ScreenHeader } from "@/components/shell/ScreenHeader";
import { useAppNavigation } from "@/components/shell/navigation";
import { useAccount } from "@/lib/account";
import { apiClient, type Schemas } from "@/lib/api/client";
import { useTranslation } from "@/lib/i18n";
import { getSessionToken } from "@/lib/session";

export const clientsPath = "/app/people";

export function clientPath(id: string): string {
  return clientsPath + "/clients/" + encodeURIComponent(id);
}

interface ClientScreenProps {
  title: string;
  back: string;
  actions?: ReactNode;
  children: ReactNode;
}

export function ClientScreen({ title, back, actions, children }: ClientScreenProps): ReactElement {
  const t = useTranslation();
  const navigate = useAppNavigation();
  return (
    <main className="client-card-screen">
      <ScreenHeader
        title={title}
        actions={actions}
        back={
          <button
            className="shell-icon-button"
            type="button"
            aria-label={t("extra.back")}
            onClick={() => navigate(back)}
          >
            <span aria-hidden="true">←</span>
          </button>
        }
      />
      {children}
    </main>
  );
}

type Card = Schemas["ClientCard"];
type Balance = Schemas["ClientBalance"];

interface ClientCardData {
  card: Card;
  history: Balance | null;
  setCard: (card: Card) => void;
}

type ClientCardResult =
  | {
      identity: string;
      state: "ready";
      card: Card;
      history: Balance | null;
    }
  | { identity: string; state: "missing" | "error" };

interface ClientCardScreenProps {
  clientId: string;
  includeHistory?: boolean;
  children: (data: ClientCardData) => ReactElement;
}

export function ClientCardScreen({
  clientId,
  includeHistory = false,
  children,
}: ClientCardScreenProps): ReactElement {
  const { account } = useAccount();
  const t = useTranslation();
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<ClientCardResult | null>(null);
  const identity = [account.id, clientId, includeHistory, attempt].join(":");
  const current = result?.identity === identity ? result : null;

  useEffect(() => {
    if (!account.activated) return;

    const controller = new AbortController();
    const token = getSessionToken();

    async function load(): Promise<void> {
      try {
        const client = apiClient(token);
        const params = { path: { client_id: clientId } };
        const signal = controller.signal;
        const [card, balance] = await Promise.all([
          client.GET("/clients/{client_id}", { params, signal, cache: "no-store" }),
          includeHistory
            ? client.GET("/clients/{client_id}/balance", { params, signal, cache: "no-store" })
            : null,
        ]);
        if (signal.aborted || getSessionToken() !== token) return;

        if (card.data && (!includeHistory || balance?.data)) {
          setResult({ identity, state: "ready", card: card.data, history: balance?.data ?? null });
        } else {
          setResult({ identity, state: card.response.status === 404 ? "missing" : "error" });
        }
      } catch {
        if (!controller.signal.aborted && getSessionToken() === token) {
          setResult({ identity, state: "error" });
        }
      }
    }

    void load();
    return () => controller.abort();
  }, [account.activated, clientId, identity, includeHistory]);

  if (!account.activated) {
    return (
      <ClientScreen title={t("clients.title")} back={clientsPath}>
        <p>{t("clients.not_found")}</p>
      </ClientScreen>
    );
  }

  if (current?.state === "ready") {
    return children({
      card: current.card,
      history: current.history,
      setCard: (card) =>
        setResult((loaded) =>
          loaded?.identity === identity && loaded.state === "ready" ? { ...loaded, card } : loaded,
        ),
    });
  }

  return (
    <ClientScreen title={t("clients.title")} back={clientsPath}>
      {current === null ? (
        <div aria-busy="true" />
      ) : (
        <>
          <p role="alert">
            {t(current.state === "missing" ? "clients.not_found" : "extra.auth_request_failed")}
          </p>
          {current.state === "error" && (
            <button
              className="shell-secondary"
              type="button"
              onClick={() => setAttempt(attempt + 1)}
            >
              {t("extra.auth_retry")}
            </button>
          )}
        </>
      )}
    </ClientScreen>
  );
}
