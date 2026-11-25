"use client";

import { useState, type FormEvent, type ReactElement } from "react";
import { ConfirmSheet } from "@/components/shell/ConfirmSheet";
import { useAppNavigation } from "@/components/shell/navigation";
import { useAccount } from "@/lib/account";
import { apiClient, errorCode, type Schemas } from "@/lib/api/client";
import { contourDomain } from "@/lib/contour";
import { useLanguage, useTranslation, type MessageKey } from "@/lib/i18n";
import { getSessionToken } from "@/lib/session";
import { shareLink } from "@/lib/share";
import { clientPath } from "./ClientCardScreen";
import { PrivateTitle } from "./PrivateTextBlock";

type Card = Schemas["ClientCard"];
type Account = Schemas["Account"];

interface LinkBlockProps {
  card: Card;
  bookingUrl: string;
  onChanged: (card: Card) => void;
}

interface Duplicate {
  id: string;
  name: string;
}

function duplicateCard(failure: unknown): Duplicate | null {
  if (typeof failure !== "object" || failure === null || !("details" in failure)) return null;
  const details = failure.details;
  if (
    typeof details !== "object" ||
    details === null ||
    !("client_id" in details) ||
    !("name" in details)
  ) {
    return null;
  }
  return typeof details.client_id === "string" && typeof details.name === "string"
    ? { id: details.client_id, name: details.name }
    : null;
}

function enteredLogin(value: string, account: Account): string | null {
  const candidate = value.trim();
  if (!candidate.includes("/")) return candidate || null;

  try {
    const address = new URL(/^https?:\/\//iu.test(candidate) ? candidate : "https://" + candidate);
    const host = new URL(account.address_url).host;
    const path = address.pathname.replace(/^\//u, "").replace(/\/$/u, "");
    return (address.host === host || address.host === contourDomain(account.contour)) &&
      !address.search &&
      !address.hash &&
      !path.includes("/")
      ? path || null
      : null;
  } catch {
    return null;
  }
}

export function LinkBlock({ card, bookingUrl, onChanged }: LinkBlockProps): ReactElement {
  const t = useTranslation();
  const language = useLanguage();
  const { account } = useAccount();
  const navigate = useAppNavigation();
  const [login, setLogin] = useState("");
  const [failedLogin, setFailedLogin] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<Duplicate | null>(null);
  const [error, setError] = useState<MessageKey | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmUnlink, setConfirmUnlink] = useState(false);
  const [copied, setCopied] = useState(false);
  const active = card.status === "active";
  const normalized = enteredLogin(login, account);
  const ownLogin = normalized?.toLowerCase() === account.login.toLowerCase();
  const disabled = busy || !normalized || ownLogin || normalized.toLowerCase() === failedLogin;
  const params = { path: { client_id: card.id } };

  async function link(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (disabled || !normalized || !active) return;
    setBusy(true);
    setError(null);
    setDuplicate(null);
    try {
      // spec:impl client-card-profile-link#make-login-link-leader-enters
      const { data, error: failure } = await apiClient(getSessionToken()).PUT(
        "/clients/{client_id}/link",
        {
          params,
          body: { login: normalized },
        },
      );
      if (data) {
        setLogin("");
        setFailedLogin(null);
        onChanged(data);
        return;
      }

      const code = errorCode(failure);
      switch (code) {
        case "link_login_not_found":
          // spec:impl client-card-profile-link#show-link-not-found-keep-saving
          setFailedLogin(normalized.toLowerCase());
          setError("client.link_not_found");
          break;
        case "link_duplicate": {
          // spec:impl client-card-profile-link#show-link-duplicate-name-other-card
          const other = duplicateCard(failure);
          setFailedLogin(normalized.toLowerCase());
          setDuplicate(other);
          if (!other) setError("extra.auth_request_failed");
          break;
        }
        default:
          setError("extra.auth_request_failed");
      }
    } catch {
      setError("extra.auth_network_error");
    } finally {
      setBusy(false);
    }
  }

  async function unlink(): Promise<void> {
    if (busy || !active) return;
    setBusy(true);
    setError(null);
    try {
      // spec:impl client-card-profile-link#break-link-after-leader-confirms
      const { data } = await apiClient(getSessionToken()).DELETE("/clients/{client_id}/link", {
        params,
      });
      if (data) onChanged(data);
      else setError("extra.auth_request_failed");
    } catch {
      setError("extra.auth_network_error");
    } finally {
      setBusy(false);
      setConfirmUnlink(false);
    }
  }

  async function invite(): Promise<void> {
    setError(null);
    try {
      const text = t("extra.client_invite_text", {
        [language === "ru" ? "ссылка" : "link"]: bookingUrl,
      });
      // spec:impl client-card-view-edit#open-system-share-menu-leader
      await shareLink(text, bookingUrl);
      if (!navigator.share) setCopied(true);
    } catch (failure) {
      if (!(failure instanceof DOMException && failure.name === "AbortError")) {
        setError("extra.auth_request_failed");
      }
    }
  }

  const marker = "\u0000";
  const [duplicateBefore, duplicateAfter] = t("client.link_duplicate", {
    [language === "ru" ? "имя" : "name"]: marker,
  }).split(marker);
  const notice = ownLogin || (login.trim() && !normalized) ? "client.link_not_found" : error;

  return (
    <section className="client-block">
      <PrivateTitle title={t("extra.client_link_title")} />
      {/* spec:impl client-card-view-edit#show-client-link-block-self-given */}
      {card.self_given_email && (
        <p className="client-read-field">
          <small>{t("extra.client_booking_email")}</small>
          <span>{card.self_given_email}</span>
        </p>
      )}
      {card.link.status === "unlinked_by_client" && (
        <p className="client-hint">{t("extra.client_unlinked")}</p>
      )}
      {card.link.status === "linked" ? (
        // spec:impl client-card-profile-link#show-linked-active-card-client
        <div className="client-linked">
          <p className="client-read-field">
            <small>{t("client.link_login")}</small>
            <span>
              {contourDomain(account.contour)}/{card.link.login}
            </span>
          </p>
          {active && (
            <button
              type="button"
              className="shell-destructive"
              onClick={() => setConfirmUnlink(true)}
            >
              {t("client.unlink")}
            </button>
          )}
        </div>
      ) : (
        active && (
          // spec:impl client-card-profile-link#show-standalone-active-card-client
          <form className="client-link-form" onSubmit={link}>
            <label className="client-field">
              <span>{t("client.link_login")}</span>
              <input
                value={login}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  setLogin(value);
                  if (enteredLogin(value, account)?.toLowerCase() === failedLogin) return;
                  setDuplicate(null);
                  setError(null);
                  setFailedLogin(null);
                }}
                type="text"
                autoCapitalize="none"
                spellCheck={false}
                disabled={busy}
              />
            </label>
            <p className="client-hint">{t("client.link_login_hint")}</p>
            {duplicate && (
              <p className="client-error" role="alert">
                {duplicateBefore}
                <button
                  className="client-text-button"
                  type="button"
                  onClick={() => navigate(clientPath(duplicate.id))}
                >
                  {duplicate.name}
                </button>
                {duplicateAfter}
              </p>
            )}
            <div className="client-inline">
              <button type="submit" className="shell-primary" disabled={disabled}>
                {t("extra.client_save")}
              </button>
              <button type="button" className="shell-secondary" onClick={() => void invite()}>
                {t("client.invite")}
              </button>
            </div>
            {copied && (
              <p className="client-hint" role="status">
                {t("profile.link_copied")}
              </p>
            )}
          </form>
        )
      )}
      {notice && (
        <p className="client-error" role="alert">
          {t(notice)}
        </p>
      )}
      {confirmUnlink && (
        <ConfirmSheet
          title={t("client.unlink")}
          text={t("client.unlink_warning")}
          confirmLabel={t("client.unlink")}
          destructive
          onConfirm={() => void unlink()}
          onClose={() => !busy && setConfirmUnlink(false)}
        />
      )}
    </section>
  );
}
