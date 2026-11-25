"use client";

import { useEffect, useState, type ReactElement } from "react";
import { useAccount } from "@/lib/account";
import { apiClient, type Schemas } from "@/lib/api/client";
import { formatDate, formatTime, zoneCity } from "@/lib/format";
import { useTranslation, type MessageKey } from "@/lib/i18n";
import type { Translate } from "@/lib/i18n/messages";
import { getSessionToken } from "@/lib/session";

type Notice = Schemas["Notice"];
type NoticeTab = Schemas["NoticeTab"];
type Context = Pick<Schemas["Account"], "language" | "time_zone">;
type NoticeAction = (notice: Notice) => Promise<void>;

interface NoticeBarProps {
  tab: NoticeTab;
  actions?: Partial<Record<string, NoticeAction>>;
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

export function NoticeBar({ tab, actions }: NoticeBarProps): ReactElement | null {
  const { account } = useAccount();
  const t = useTranslation();
  const [feed, setFeed] = useState<NoticeFeed | null>(null);
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const current = feed?.accountId === account.id && feed.tab === tab ? feed.items : [];

  useEffect(() => {
    const token = getSessionToken();
    if (!token) {
      return;
    }

    const controller = new AbortController();
    async function load(session: string): Promise<void> {
      try {
        const { data } = await apiClient(session).GET("/notices", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (controller.signal.aborted || getSessionToken() !== session) {
          return;
        }

        if (data) {
          setFeed({
            accountId: account.id,
            tab,
            items: data.items.filter((notice) => notice.tab === tab),
          });
          setFailed(false);
        } else {
          setFailed(true);
        }
      } catch {
        if (!controller.signal.aborted && getSessionToken() === session) {
          setFailed(true);
        }
      }
    }

    void load(token);
    return () => controller.abort();
  }, [account.id, tab, attempt]);

  async function remove(notice: Notice, action?: NoticeAction): Promise<void> {
    const token = getSessionToken();
    if (!token || pending) {
      return;
    }

    setPending(true);
    try {
      if (action) {
        await action(notice);
      } else {
        const { response } = await apiClient(token).DELETE("/notices/{notice_id}", {
          params: { path: { notice_id: notice.id } },
        });
        if (!response.ok && response.status !== 404) {
          setFailed(true);
          return;
        }
      }

      setFeed((old) =>
        old === null ? null : { ...old, items: old.items.filter(({ id }) => id !== notice.id) },
      );
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  }

  const visible = current.flatMap((notice) => {
    const copy = noticeCopy(notice, account, t);
    return copy ? [{ notice, copy }] : [];
  });
  if (visible.length === 0 && !failed) {
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
                      onClick={() => void remove(notice, action)}
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
      {failed && (
        <p className="shell-notice-error" role="alert">
          {t("extra.auth_request_failed")}{" "}
          <button
            type="button"
            className="shell-notice-action"
            onClick={() => setAttempt((value) => value + 1)}
            disabled={pending}
          >
            {t("extra.auth_retry")}
          </button>
        </p>
      )}
    </div>
  );
}
