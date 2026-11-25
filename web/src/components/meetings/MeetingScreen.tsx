"use client";

import { useEffect, useState, type ReactElement, type ReactNode } from "react";
import { ScreenHeader } from "@/components/shell/ScreenHeader";
import { useAppNavigation } from "@/components/shell/navigation";
import { useAccount } from "@/lib/account";
import { apiClient, type Schemas } from "@/lib/api/client";
import { useTranslation } from "@/lib/i18n";
import { getSessionToken } from "@/lib/session";
import "./meeting.css";

export const meetingsPath = "/app/meetings";

export function meetingPath(id: string): string {
  return meetingsPath + "/" + encodeURIComponent(id);
}

interface MeetingScreenProps {
  title: string;
  back?: string;
  actions?: ReactNode;
  children: ReactNode;
}

export function MeetingScreen({
  title,
  back = meetingsPath,
  actions,
  children,
}: MeetingScreenProps): ReactElement {
  const navigate = useAppNavigation();
  const t = useTranslation();
  return (
    <main className="meeting-screen">
      <ScreenHeader
        title={title}
        actions={actions}
        back={
          <button
            type="button"
            className="shell-icon-button"
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

type Detail = Schemas["MeetingDetail"];
type Result = { key: string; meeting: Detail | null; notFound: boolean };

interface MeetingResourceProps {
  id: string;
  children: (meeting: Detail, replace: (meeting: Detail) => void) => ReactElement;
}

export function MeetingResource({ id, children }: MeetingResourceProps): ReactElement {
  const t = useTranslation();
  const { account } = useAccount();
  const [result, setResult] = useState<Result | null>(null);
  const [attempt, setAttempt] = useState(0);
  const key = [account.id, id, attempt].join(":");
  const active = account.activated;
  const visible = result?.key === key ? result : null;
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    const token = getSessionToken();

    async function load(): Promise<void> {
      try {
        const { data, response } = await apiClient(token).GET("/meetings/{meeting_id}", {
          params: { path: { meeting_id: id } },
          signal: controller.signal,
          cache: "no-store",
        });
        if (!controller.signal.aborted && getSessionToken() === token) {
          setResult({ key, meeting: data ?? null, notFound: response.status === 404 });
        }
      } catch {
        if (!controller.signal.aborted && getSessionToken() === token)
          setResult({ key, meeting: null, notFound: false });
      }
    }

    void load();
    return () => controller.abort();
  }, [active, key, id]);

  if (active && visible?.meeting) {
    return children(visible.meeting, (meeting) =>
      setResult((previous) => (previous?.key === key ? { ...previous, meeting } : previous)),
    );
  }

  return (
    <MeetingScreen title={t("meetings.title")}>
      {!active || visible?.notFound ? (
        <p role="alert">{t("extra.meeting_missing")}</p>
      ) : visible ? (
        <>
          <p role="alert">{t("extra.auth_request_failed")}</p>
          <button type="button" className="shell-secondary" onClick={() => setAttempt(attempt + 1)}>
            {t("extra.auth_retry")}
          </button>
        </>
      ) : (
        <div aria-busy="true" />
      )}
    </MeetingScreen>
  );
}
