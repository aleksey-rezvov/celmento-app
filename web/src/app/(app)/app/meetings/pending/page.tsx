"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactElement } from "react";
import { compareMeetingStarts, endOfMeeting } from "@/components/schedule/schedule-data";
import { EmptyState } from "@/components/shell/EmptyState";
import { ScreenHeader } from "@/components/shell/ScreenHeader";
import { useAccount } from "@/lib/account";
import { apiClient, type Schemas } from "@/lib/api/client";
import { formatDate } from "@/lib/format";
import { useTranslation } from "@/lib/i18n";
import { putMeetingOutcome } from "@/lib/meeting-api";
import { meetingTitle } from "@/lib/meeting-display";
import { getSessionToken } from "@/lib/session";
import { zonedClock } from "@/lib/zoned-date";
import "../schedule.css";

type Meeting = Schemas["Meeting"];

export default function PendingMeetings(): ReactElement | null {
  const { account } = useAccount();
  const router = useRouter();
  const t = useTranslation();
  const [items, setItems] = useState<Meeting[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const { activated, language, time_zone: zone } = account;

  useEffect(() => {
    if (!activated) {
      router.replace("/app/meetings");
      return;
    }

    const controller = new AbortController();
    const { signal } = controller;
    async function load(): Promise<void> {
      try {
        const { data } = await apiClient(getSessionToken()).GET("/meetings/pending-outcomes", {
          signal,
          cache: "no-store",
        });
        if (!signal.aborted && data) {
          // spec:impl pending-outcomes#list-screen-3-5-meeting-awaiting
          setItems(data.items.toSorted(compareMeetingStarts));
          setLoadFailed(false);
        } else if (!signal.aborted) {
          setLoadFailed(true);
        }
      } catch {
        if (!signal.aborted) setLoadFailed(true);
      }
    }

    void load();
    return () => controller.abort();
  }, [account.id, activated, attempt, router]);

  async function markMutualMissed(meeting: Meeting): Promise<void> {
    if (busy) return;
    setBusy(meeting.id);
    setSaveFailed(false);
    try {
      const saved = await putMeetingOutcome(meeting.id, { status: "not_taken_place" });
      if (saved) setItems((current) => current?.filter(({ id }) => id !== meeting.id) ?? null);
      else setSaveFailed(true);
    } catch {
      setSaveFailed(true);
    } finally {
      setBusy(null);
    }
  }

  // spec:impl pending-outcomes#show-bar-badge-screen-3-5
  if (!activated) return null;

  return (
    <main>
      <ScreenHeader
        title={t("meetings.need_outcome_bar", { N: items?.length ?? 0 })}
        back={
          <Link className="shell-icon-button" href="/app/meetings" aria-label={t("extra.back")}>
            <span aria-hidden="true">←</span>
          </Link>
        }
      />
      {loadFailed && (
        <div className="schedule-error" role="alert">
          <p>{t("extra.auth_request_failed")}</p>
          <button
            type="button"
            className="shell-secondary"
            onClick={() => setAttempt((value) => value + 1)}
          >
            {t("extra.auth_retry")}
          </button>
        </div>
      )}
      {saveFailed && (
        <p className="schedule-error" role="alert">
          {t("extra.auth_request_failed")}
        </p>
      )}
      {items === null && !loadFailed && <div aria-busy="true" />}
      {/* spec:impl pending-outcomes#show-list-empty-character */}
      {items?.length === 0 && (
        <EmptyState character="meetings_need_outcome_empty" textKey="meetings.need_outcome_empty" />
      )}
      {items && items.length > 0 && (
        <ul className="schedule-pending-list">
          {items.map((meeting) => {
            const path = `/app/meetings/${encodeURIComponent(meeting.id)}`;
            const when = formatDate(meeting.starts_at, zone, language);
            const start = zonedClock(meeting.starts_at, zone);
            const end = zonedClock(endOfMeeting(meeting), zone);
            return (
              <li key={meeting.id} className="schedule-pending-row">
                {/* spec:impl pending-outcomes#open-meeting-card-row-tapped */}
                <Link href={path} className="schedule-pending-detail">
                  <span>
                    {when} · {start}–{end}
                  </span>{" "}
                  <strong>{meetingTitle(meeting, t)}</strong>
                </Link>
                {/* spec:impl pending-outcomes#show-done-missed-row-start */}
                <div className="schedule-pending-actions">
                  <Link
                    className="shell-secondary"
                    href={`${path}/outcome?status=completed&from=pending`}
                  >
                    {t("outcome.done")}
                  </Link>
                  {meeting.type === "mutual_practice" ? (
                    <button
                      className="shell-secondary"
                      type="button"
                      disabled={busy !== null}
                      onClick={() => void markMutualMissed(meeting)}
                    >
                      {t("outcome.missed")}
                    </button>
                  ) : (
                    <Link
                      className="shell-secondary"
                      href={`${path}/outcome?status=not_taken_place&from=pending`}
                    >
                      {t("outcome.missed")}
                    </Link>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
