"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, type ReactElement } from "react";
import { OfflineHint } from "@/components/OfflineHint";
import { MeetingForm } from "@/components/meetings/MeetingForm";
import { MeetingScreen, meetingPath, meetingsPath } from "@/components/meetings/MeetingScreen";
import { initialDraft } from "@/components/meetings/meeting-form-values";
import { useAccount } from "@/lib/account";
import { apiClient, type Schemas } from "@/lib/api/client";
import { useTranslation } from "@/lib/i18n";
import { loadDraft, type MeetingDraft } from "@/lib/meeting-draft";
import { useOnline } from "@/lib/online";
import { zonedDay, zonedInstant } from "@/lib/zoned-date";

interface LoadedDraft {
  key: string;
  draft: MeetingDraft | null;
  resumed?: boolean;
}

function NewMeeting(): ReactElement {
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const t = useTranslation();
  const { account, currentSessionToken } = useAccount();
  const online = useOnline();
  const [loaded, setLoaded] = useState<LoadedDraft | null>(null);
  const [attempt, setAttempt] = useState(0);
  const requestedDate = params.get("date");
  const requestedStart = params.get("starts_at");
  const clientId = params.get("client_id");
  const resume = params.get("resume") === "1";
  const { id: owner, time_zone: timeZone, activated } = account;
  const defaultDuration = account.leader?.session_duration_minutes ?? 60;
  const defaultLink = account.leader?.default_meeting_link ?? null;
  const defaultCurrency = account.leader?.default_currency ?? "RUB";
  const key = [owner, requestedDate, requestedStart, clientId, resume, attempt].join(":");
  const current = loaded?.key === key ? loaded : null;
  const ready = Boolean(current?.draft);

  useEffect(() => {
    if (!activated || ready || (!online && !resume)) return;
    const controller = new AbortController();
    async function open(): Promise<void> {
      const token = currentSessionToken();
      if (!token) return;
      const saved = resume ? loadDraft(owner, pathname) : null;
      if (saved) {
        await Promise.resolve();
        if (!controller.signal.aborted && currentSessionToken() === token)
          setLoaded({ key, draft: saved, resumed: true });
        return;
      }
      if (!online) return;

      try {
        const client = apiClient(token);
        const selectedStart =
          requestedStart &&
          /(?:Z|[+-]\d\d:\d\d)$/u.test(requestedStart) &&
          Number.isFinite(Date.parse(requestedStart))
            ? requestedStart
            : null;
        const date =
          requestedDate && zonedInstant(requestedDate, "12:00", timeZone)
            ? requestedDate
            : zonedDay(new Date(), timeZone);
        const signal = controller.signal;
        const [defaults, selected] = await Promise.all([
          selectedStart
            ? Promise.resolve({
                data: {
                  starts_at: selectedStart,
                  duration_minutes: defaultDuration,
                  meeting_link: defaultLink,
                  currency: defaultCurrency,
                } satisfies Schemas["MeetingDefaults"],
              })
            : client.GET("/meetings/defaults", {
                params: { query: { date } },
                signal,
                cache: "no-store",
              }),
          clientId
            ? client.GET("/clients/{client_id}", {
                params: { path: { client_id: clientId } },
                signal,
                cache: "no-store",
              })
            : null,
        ]);
        if (controller.signal.aborted || currentSessionToken() !== token) return;
        setLoaded({
          key,
          draft:
            defaults.data && (!clientId || selected?.data?.status === "active")
              ? initialDraft(timeZone, defaults.data, selected?.data ?? null)
              : null,
        });
      } catch {
        if (!controller.signal.aborted && currentSessionToken() === token)
          setLoaded({ key, draft: null });
      }
    }

    void open();
    return () => controller.abort();
  }, [
    activated,
    clientId,
    currentSessionToken,
    defaultCurrency,
    defaultDuration,
    defaultLink,
    key,
    online,
    owner,
    pathname,
    ready,
    requestedDate,
    requestedStart,
    resume,
    timeZone,
  ]);

  if (account.activated && current?.draft) {
    return (
      <MeetingForm
        initial={current.draft}
        resumed={current.resumed}
        onSaved={(meeting) => {
          if (meeting.status === "scheduled") {
            const date = zonedDay(meeting.starts_at, account.time_zone);
            router.replace(meetingsPath + "?date=" + encodeURIComponent(date));
          } else router.replace(meetingPath(meeting.id));
        }}
      />
    );
  }

  return (
    <MeetingScreen title={t("meetings.empty_day_cta")}>
      {!account.activated ? (
        <p>{t("extra.meeting_missing")}</p>
      ) : !online ? (
        <OfflineHint message="extra.meeting_offline" />
      ) : current ? (
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

export default function NewMeetingPage(): ReactElement {
  return (
    <Suspense fallback={<div aria-busy="true" />}>
      <NewMeeting />
    </Suspense>
  );
}
