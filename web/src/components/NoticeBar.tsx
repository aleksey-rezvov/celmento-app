"use client";

import { useEffect, useRef, useState, type ReactElement } from "react";
import { ConfirmSheet } from "@/components/shell/ConfirmSheet";
import { useAccount } from "@/lib/account";
import { apiClient, type Schemas } from "@/lib/api/client";
import { formatDate, formatTime, zoneCity } from "@/lib/format";
import { useTranslation, type MessageKey } from "@/lib/i18n";
import type { Translate } from "@/lib/i18n/messages";
import { listAccountNotices } from "@/lib/notices";
import { subscribeVisibleRevalidation } from "@/lib/visible-revalidation";

type Notice = Schemas["Notice"];
type NoticeTab = Schemas["NoticeTab"];
type Context = Pick<Schemas["Account"], "language" | "time_zone">;
type NoticeAction = (notice: Notice) => Promise<void>;

interface NoticeBarProps {
  tab: NoticeTab;
  actions?: Partial<Record<string, NoticeAction>>;
  confirmations?: Partial<Record<Notice["key"], string>>;
  items?: readonly Notice[];
}

type NoticeFailure = "load" | { notice: Notice; action?: NoticeAction };

interface NoticeConfirmation {
  notice: Notice;
  action: NoticeAction;
  label: MessageKey;
  text: string;
}

interface NoticeFeed {
  accountId: string;
  tab: NoticeTab;
  items: Notice[];
}

interface NoticeCopy {
  text: string;
  name?: string;
}

function dateTime(instant: string | undefined, { language, time_zone }: Context): string | null {
  if (!instant || Number.isNaN(Date.parse(instant))) {
    return null;
  }

  const date = formatDate(instant, time_zone, language);
  const time = formatTime(instant, time_zone, language);
  return `${date}, ${time} (${zoneCity(time_zone, language)})`;
}

function noticeCopy({ key, params }: Notice, account: Context, t: Translate): NoticeCopy | null {
  // spec:impl in-app-notice-bar#show-notification-text-key-named
  switch (key) {
    case "notify.limit_new_client":
      return { text: t(key), name: params.name };
    case "notify.archived_client_tried":
      return params.name ? { text: t(key, { name: params.name, имя: params.name }) } : null;
    case "notify.invite_registered":
      return params.name && params.login
        ? {
            text: t(key, {
              Name: params.name,
              Имя: params.name,
              login: params.login,
              логин: params.login,
            }),
          }
        : null;
    case "client.linked_notice":
      return params.specialist_name
        ? { text: t(key, { Name: params.specialist_name, Имя: params.specialist_name }) }
        : null;
    case "notify.rescheduled": {
      const previous = dateTime(params.previous_starts_at, account);
      const next = dateTime(params.starts_at, account);
      return previous && next
        ? {
            text: t(key)
              .replace(/\{[^{}]+\}/u, previous)
              .replace(/\{[^{}]+\}/u, next),
            name: params.specialist_name,
          }
        : null;
    }
    case "notify.cancelled": {
      const when = dateTime(params.starts_at, account);
      return when
        ? {
            text: t(key, { "date, time": when, "дата, время": when }),
            name: params.specialist_name,
          }
        : null;
    }
    case "admin.access_granted": {
      if (!params.date || Number.isNaN(Date.parse(params.date))) {
        return null;
      }

      const date = formatDate(params.date, "UTC", account.language);
      return { text: t(key, { date, дата: date }) };
    }
    default:
      return null;
  }
}

function actionLabel(notice: Notice): MessageKey | null {
  return notice.key === "client.linked_notice" ? "client.unlink" : null;
}

export function NoticeBar({
  tab,
  actions,
  confirmations,
  items,
}: NoticeBarProps): ReactElement | null {
  const { account, currentSessionToken } = useAccount();
  const t = useTranslation();
  const [feed, setFeed] = useState<NoticeFeed | null>(null);
  const [failure, setFailure] = useState<NoticeFailure | null>(null);
  const [pending, setPending] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [confirmation, setConfirmation] = useState<NoticeConfirmation | null>(null);
  const [dismissed, setDismissed] = useState<{ accountId: string; ids: Set<string> }>();
  const mutation = useRef(false);
  const externallyLoaded = items !== undefined;
  const current = items ?? (feed?.accountId === account.id && feed.tab === tab ? feed.items : []);
  const hiddenIds = dismissed?.accountId === account.id ? dismissed.ids : null;

  useEffect(() => {
    const token = currentSessionToken();
    if (!token || externallyLoaded) return;

    let pendingRequest: AbortController | null = null;
    let loaded = false;
    async function load(session: string): Promise<void> {
      if (pendingRequest || currentSessionToken() !== session) return;
      const controller = new AbortController();
      pendingRequest = controller;
      try {
        const next = await listAccountNotices(session, controller.signal);
        if (controller.signal.aborted || currentSessionToken() !== session) return;

        if (next) {
          loaded = true;
          setFeed({ accountId: account.id, tab, items: next });
          setFailure((previous) => (previous === "load" ? null : previous));
        } else if (!loaded) {
          setFailure("load");
        }
      } catch {
        if (!loaded && !controller.signal.aborted && currentSessionToken() === session)
          setFailure("load");
      } finally {
        pendingRequest = null;
      }
    }

    void load(token);
    const unsubscribe = subscribeVisibleRevalidation(() => void load(token));
    return () => {
      unsubscribe();
      pendingRequest?.abort();
    };
  }, [account.id, attempt, currentSessionToken, externallyLoaded, tab]);

  async function remove(notice: Notice, action?: NoticeAction): Promise<void> {
    const session = currentSessionToken();
    if (!session || mutation.current) return;

    mutation.current = true;
    setPending(true);
    setFailure(null);
    try {
      if (action) {
        await action(notice);
      } else {
        const { response } = await apiClient(session).DELETE("/notices/{notice_id}", {
          params: { path: { notice_id: notice.id } },
        });
        if (!response.ok && response.status !== 404) throw new Error("Notice dismissal failed.");
      }

      if (currentSessionToken() !== session) return;
      setDismissed((old) => ({
        accountId: account.id,
        ids: new Set([...(old?.accountId === account.id ? old.ids : []), notice.id]),
      }));
      setConfirmation(null);
    } catch {
      if (currentSessionToken() === session) setFailure({ notice, action });
    } finally {
      mutation.current = false;
      setPending(false);
    }
  }

  const visible = current.flatMap((notice) => {
    if (notice.tab !== tab || hiddenIds?.has(notice.id)) return [];
    const copy = noticeCopy(notice, account, t);
    return copy ? [{ notice, copy }] : [];
  });
  if (visible.length === 0 && !failure && !confirmation) {
    return null;
  }

  // spec:impl in-app-notice-bar#show-in-app-notification-bar-top
  return (
    <div className="shell-notices">
      {visible.length > 0 && (
        <ul className="shell-notice-list">
          {visible.map(({ notice, copy }) => {
            const label = actionLabel(notice);
            const action = label && actions?.[notice.key];

            return (
              <li className="shell-notice" key={notice.id}>
                <div>
                  <p>{copy.text}</p>
                  {copy.name && <p className="shell-notice-name">{copy.name}</p>}
                  {label && action && (
                    <button
                      type="button"
                      className="shell-notice-action"
                      onClick={() => {
                        const text = confirmations?.[notice.key];
                        if (text) {
                          setFailure(null);
                          setConfirmation({ notice, action, label, text });
                        } else {
                          void remove(notice, action);
                        }
                      }}
                      disabled={pending}
                    >
                      {t(label)}
                    </button>
                  )}
                </div>
                <button
                  type="button"
                  className="shell-icon-button"
                  aria-label={t("extra.notice_dismiss")}
                  onClick={() => void remove(notice)}
                  disabled={pending}
                >
                  <span aria-hidden="true">×</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {failure && !confirmation && (
        <p className="shell-notice-error" role="alert">
          {t("extra.auth_request_failed")}{" "}
          <button
            type="button"
            className="shell-notice-action"
            onClick={() => {
              if (failure === "load") setAttempt((value) => value + 1);
              else void remove(failure.notice, failure.action);
            }}
            disabled={pending}
          >
            {t("extra.auth_retry")}
          </button>
        </p>
      )}
      {confirmation && (
        <ConfirmSheet
          title={t(confirmation.label)}
          text={confirmation.text}
          confirmLabel={t(confirmation.label)}
          destructive
          pending={pending}
          error={failure ? t("extra.auth_request_failed") : null}
          onConfirm={() => void remove(confirmation.notice, confirmation.action)}
          onClose={() => {
            setConfirmation(null);
            setFailure(null);
          }}
        />
      )}
    </div>
  );
}
