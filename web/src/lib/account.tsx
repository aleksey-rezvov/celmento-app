"use client";

import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { DeviceScreen } from "@/components/auth/DeviceScreen";
import { apiClient, type Schemas } from "./api/client";
import { LanguageProvider, useTranslation } from "./i18n";
import { clearSessionToken, getSessionToken } from "./session";

type Account = Schemas["Account"];

interface AccountState {
  account: Account;
  refresh: (next?: Account) => Promise<void>;
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
  const [account, setAccount] = useState<Account | null>(null);
  const [failed, setFailed] = useState(false);
  const requestSequence = useRef(0);

  const reloadAccount = useCallback(async (): Promise<void> => {
    const request = ++requestSequence.current;
    const token = getSessionToken();

    if (!token) {
      router.replace("/login");
      return;
    }

    await apiClient(token)
      .GET("/account", { cache: "no-store" })
      .then(
        ({ data, response }) => {
          if (request !== requestSequence.current || getSessionToken() !== token) {
            return;
          }

          if (response.status === 401) {
            clearSessionToken();
            setAccount(null);
            router.replace("/login");
          } else if (data) {
            setFailed(false);
            setAccount(data);
          } else {
            setFailed(true);
          }
        },
        () => {
          if (request === requestSequence.current && getSessionToken() === token) {
            setFailed(true);
          }
        },
      );
  }, [router]);

  const refresh = useCallback(
    async (next?: Account): Promise<void> => {
      if (next && getSessionToken()) {
        requestSequence.current += 1;
        setAccount((current) => (current?.id === next.id ? next : current));
        return;
      }

      await reloadAccount();
    },
    [reloadAccount],
  );

  useEffect(() => {
    void reloadAccount();
    return () => {
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
    return failed ? (
      <DeviceScreen>
        <AccountError retry={() => void refresh()} />
      </DeviceScreen>
    ) : (
      <main aria-busy="true" />
    );
  }

  return (
    <AccountContext.Provider value={{ account, refresh }}>
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
