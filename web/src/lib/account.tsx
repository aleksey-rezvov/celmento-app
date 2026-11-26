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
import { clearSessionToken, getSessionToken, subscribeSession } from "./session";

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

    const showError = (): void => {
      setSnapshot((previous) =>
        previous?.token === session ? previous : { token: session, account: null },
      );
    };

    try {
      const { data, response } = await apiClient(session).GET("/account", { cache: "no-store" });
      if (request !== requestSequence.current || !currentSessionToken()) return;

      if (response.status === 401) {
        clearSessionToken();
        setSnapshot(null);
      } else if (data) {
        setSnapshot({ token: session, account: data });
      } else {
        showError();
      }
    } catch {
      if (request === requestSequence.current && currentSessionToken()) showError();
    }
  }, [currentSessionToken, router, token]);

  const refresh = useCallback(
    async (next?: Account): Promise<void> => {
      if (next) {
        const session = currentSessionToken();
        if (session === null) return;
        requestSequence.current += 1;
        setSnapshot((previous) =>
          previous?.token === session && previous.account?.id === next.id
            ? { token: session, account: next }
            : previous,
        );
        return;
      }

      await reloadAccount();
    },
    [currentSessionToken, reloadAccount],
  );

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) void reloadAccount();
    });
    return () => {
      active = false;
      requestSequence.current += 1;
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
