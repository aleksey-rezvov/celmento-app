"use client";

import { useEffect, useState, type ReactElement } from "react";
import { meetingPath } from "@/components/meetings/MeetingScreen";
import { useAppNavigation } from "@/components/shell/navigation";
import { useAccount } from "@/lib/account";
import { apiClient, type Schemas } from "@/lib/api/client";
import { formatDate, formatMoney, formatTime } from "@/lib/format";
import { useLanguage, useTranslation } from "@/lib/i18n";
import { meetingStatusLabels } from "@/lib/meeting-display";
import { getSessionToken } from "@/lib/session";
import { clientPath } from "./ClientCardScreen";

type Meeting = Schemas["Meeting"];
type Meetings = Schemas["ClientMeetingList"];
type Result = { key: string; data: Meetings | null };

interface ClientMeetingRowsProps {
  clientId: string;
  compact?: boolean;
}

export function ClientMeetingRows({
  clientId,
  compact = false,
}: ClientMeetingRowsProps): ReactElement {
  const { account } = useAccount();
  const t = useTranslation();
  const language = useLanguage();
  const navigate = useAppNavigation();
  const [result, setResult] = useState<Result | null>(null);
  const [attempt, setAttempt] = useState(0);
  const key = [account.id, clientId, compact, attempt].join(":");
  const current = result?.key === key ? result : null;

  useEffect(() => {
    const controller = new AbortController();
    const token = getSessionToken();

    async function load(): Promise<void> {
      try {
        const { data } = await apiClient(token).GET("/clients/{client_id}/meetings", {
          params: { path: { client_id: clientId }, query: { limit: compact ? 2 : undefined } },
          signal: controller.signal,
          cache: "no-store",
        });
        if (!controller.signal.aborted && getSessionToken() === token)
          setResult({ key, data: data ?? null });
      } catch {
        if (!controller.signal.aborted && getSessionToken() === token)
          setResult({ key, data: null });
      }
    }

    void load();
    return () => controller.abort();
  }, [clientId, compact, key]);

  if (!current) return <div aria-busy="true" />;
  if (!current.data)
    return (
      <div>
        <p className="client-error" role="alert">
          {t("extra.auth_request_failed")}
        </p>
        <button type="button" className="shell-secondary" onClick={() => setAttempt(attempt + 1)}>
          {t("extra.auth_retry")}
        </button>
      </div>
    );
  const { upcoming, past } = current.data;
  if (!upcoming.length && !past.length)
    return <p className="client-hint">{t("client.no_meetings")}</p>;

  function rows(items: Meeting[], showOutcome: boolean): ReactElement {
    return (
      <ul className="client-meeting-list">
        {items.map((meeting) => (
          // spec:impl client-card-view-edit#open-meeting-card-meeting-tapped
          <li key={meeting.id}>
            <button
              type="button"
              className="client-meeting-row"
              onClick={() => navigate(meetingPath(meeting.id))}
            >
              <span>
                <strong>
                  {formatDate(meeting.starts_at, account.time_zone, language)} ·{" "}
                  {formatTime(meeting.starts_at, account.time_zone, language)}
                </strong>
                <small>{t(meetingStatusLabels[meeting.status])}</small>
              </span>
              {!compact && showOutcome && meeting.price && (
                <span>{formatMoney(meeting.price, language)}</span>
              )}
              <span aria-hidden="true">›</span>
            </button>
          </li>
        ))}
      </ul>
    );
  }

  // spec:impl client-card-view-edit#show-meetings-block-2-nearest
  return (
    <>
      {upcoming.length > 0 && (
        <section className="client-meeting-group">
          {!compact && <h2>{t("c.upcoming")}</h2>}
          {rows(compact ? upcoming.slice(0, 2) : upcoming, false)}
        </section>
      )}
      {past.length > 0 && (
        <section className="client-meeting-group">
          {!compact && <h2>{t("c.past")}</h2>}
          {rows(compact ? past.slice(0, 2) : past, true)}
        </section>
      )}
    </>
  );
}

interface MeetingsBlockProps {
  clientId: string;
}

export function MeetingsBlock({ clientId }: MeetingsBlockProps): ReactElement {
  const t = useTranslation();
  const navigate = useAppNavigation();
  return (
    <section className="client-block">
      <h2>{t("client.meetings")}</h2>
      <ClientMeetingRows clientId={clientId} compact />
      {/* spec:impl client-card-view-edit#open-screen-6-3-all-meetings-listing */}
      <button
        type="button"
        className="shell-secondary"
        onClick={() => navigate(clientPath(clientId) + "/meetings")}
      >
        {t("client.all_meetings")}
      </button>
    </section>
  );
}
