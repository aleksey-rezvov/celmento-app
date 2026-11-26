"use client";

import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactElement,
  type ReactNode,
} from "react";
import { DeviceScreen } from "@/components/auth/DeviceScreen";
import { apiClient, type Schemas } from "./api/client";
import { LanguageProvider, useTranslation } from "./i18n";
import { offlineCache } from "./offline-cache";
import { getSessionToken, subscribeSession } from "./session";

type Account = Schemas["Account"];

interface AccountState {
  account: Account;
  refresh: (next?: Account) => Promise<void>;
  currentSessionToken: () => string | null;
}

interface AccountSnapshot {
  token: string;
  account: Account | null;
}

const AccountContext = createContext<AccountState | null>(null);

interface AccountProviderProps {
  children: ReactNode;
}

interface AccountErrorProps {
  retry: () => void;
}

function AccountError({ retry }: AccountErrorProps): ReactElement {
  const t = useTranslation();

  return (
    <main className="shell-account-error">
      <p role="alert">{t("extra.auth_request_failed")}</p>
      <button type="button" className="shell-primary" onClick={retry}>
        {t("extra.auth_retry")}
      </button>
    </main>
  );
}

export function AccountProvider({ children }: AccountProviderProps): ReactElement {
  const router = useRouter();
  const token = useSyncExternalStore(subscribeSession, getSessionToken, () => null);
  const [snapshot, setSnapshot] = useState<AccountSnapshot | null>(null);
  const requestSequence = useRef(0);
  const current = snapshot?.token === token ? snapshot : null;
  const account = current?.account ?? null;
  const currentSessionToken = useCallback(
    (): string | null => (getSessionToken() === token ? token : null),
    [token],
  );

  const reloadAccount = useCallback(async (): Promise<void> => {
    if (token === null) {
      if (getSessionToken() === null) router.replace("/login");
      return;
    }
    const session = currentSessionToken();
    if (session === null) return;
    const request = ++requestSequence.current;
    const cache = offlineCache(currentSessionToken);
    const active = (): boolean =>
      request === requestSequence.current && currentSessionToken() === session;

    const showError = (): void => {
      setSnapshot((previous) =>
        previous?.token === session ? previous : { token: session, account: null },
      );
    };
    const recover = async (): Promise<void> => {
      const cached = (await cache)?.account();
      if (!active()) return;
      if (cached) setSnapshot({ token: session, account: cached });
      else showError();
    };

    if (navigator.onLine === false) {
      await recover();
      return;
    }

    try {
      const { data, response } = await apiClient(session).GET("/account", {
        cache: "no-store",
      });
      if (!active()) return;

      if (response.status === 403 || response.status === 404) {
        setSnapshot({ token: session, account: null });
        (await cache)?.clear();
      } else if (data) {
        const stored = await cache;
        if (!active()) return;
        stored?.saveAccount(data);
        setSnapshot({ token: session, account: data });
      } else {
        showError();
      }
    } catch {
      if (active()) await recover();
    }
  }, [currentSessionToken, router, token]);

  const refresh = useCallback(
    async (next?: Account): Promise<void> => {
      if (next) {
        const session = currentSessionToken();
        if (session === null || account?.id !== next.id) return;
        const request = ++requestSequence.current;
        setSnapshot((previous) =>
          previous?.token === session && previous.account?.id === next.id
            ? { token: session, account: next }
            : previous,
        );
        const cache = await offlineCache(currentSessionToken);
        if (request === requestSequence.current) cache?.saveAccount(next);
        return;
      }

      await reloadAccount();
    },
    [account?.id, currentSessionToken, reloadAccount],
  );

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) void reloadAccount();
    });
    function reconnect(): void {
      void reloadAccount();
    }
    window.addEventListener("online", reconnect);
    return () => {
      active = false;
      requestSequence.current += 1;
      window.removeEventListener("online", reconnect);
    };
  }, [reloadAccount]);

  const language = account?.language;
  useEffect(() => {
    if (language) {
      document.documentElement.lang = language;
    }
  }, [language]);

  if (account === null) {
    return current ? (
      <DeviceScreen>
        <AccountError retry={() => void refresh()} />
      </DeviceScreen>
    ) : (
      <main aria-busy="true" />
    );
  }

  return (
    <AccountContext.Provider key={token} value={{ account, refresh, currentSessionToken }}>
      <LanguageProvider language={account.language}>{children}</LanguageProvider>
    </AccountContext.Provider>
  );
}

export function useAccount(): AccountState {
  const account = useContext(AccountContext);
  if (account === null) {
    throw new Error("The account provider is required.");
  }

  return account;
}

export function mainScreenPath(account: Account): "/app/meetings" | "/app/people" {
  return account.activated ? "/app/meetings" : "/app/people";
}
