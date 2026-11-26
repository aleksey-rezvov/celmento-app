"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { useAccount } from "@/lib/account";
import type { Schemas } from "@/lib/api/client";
import { useTranslation, type MessageKey } from "@/lib/i18n";
import { DayView } from "./DayView";
import {
  listScheduledMeetings,
  ScheduleAccessLost,
  ScheduleOffline,
  scheduleItems,
  type OnScheduleLoaded,
} from "./schedule-data";
import { useScheduleRevalidation } from "./useScheduleRevalidation";

interface DayScheduleProps {
  day: string;
  leader: boolean;
  now: Date;
  onMove: (distance: number) => void;
  onCreateAt: (startsAt: string) => void;
  onOpen: (id: string) => void;
  onOpenAttended: (id: string) => void;
  onScheduleLoaded: OnScheduleLoaded;
}

export function DaySchedule({
  day,
  leader,
  onScheduleLoaded,
  ...view
}: DayScheduleProps): ReactElement {
  const t = useTranslation();
  const { account, currentSessionToken } = useAccount();
  const [schedule, setSchedule] = useState<Schemas["MeetingList"] | null>(null);
  const [failed, setFailed] = useState<MessageKey | null>(null);
  const [attempt, setAttempt] = useState(0);
  const loading = useRef(false);
  const refresh = useCallback(() => {
    if (!loading.current) setAttempt((value) => value + 1);
  }, []);
  useScheduleRevalidation(schedule, refresh);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    loading.current = true;
    void listScheduledMeetings(
      { from: day, to: day },
      account.time_zone,
      currentSessionToken,
      signal,
    )
      .then(
        (snapshot) => {
          if (signal.aborted) return;
          setSchedule(snapshot.schedule);
          setFailed(null);
          onScheduleLoaded(snapshot);
        },
        (error: unknown) => {
          if (signal.aborted) return;
          if (error instanceof ScheduleAccessLost) {
            setSchedule(null);
            onScheduleLoaded(null);
          }
          setFailed(
            error instanceof ScheduleOffline
              ? "extra.meeting_offline"
              : "extra.auth_request_failed",
          );
        },
      )
      .finally(() => {
        if (!signal.aborted) loading.current = false;
      });
    return () => controller.abort();
  }, [account.time_zone, attempt, currentSessionToken, day, onScheduleLoaded]);

  const meetings = useMemo(
    () => (schedule ? scheduleItems(schedule, leader) : []),
    [leader, schedule],
  );

  return (
    <>
      {failed && (
        <div role="alert" className="schedule-error">
          <p>{t(failed)}</p>
          <button className="shell-secondary" type="button" onClick={refresh}>
            {t("extra.auth_retry")}
          </button>
        </div>
      )}
      {schedule === null ? (
        <div aria-busy={!failed} />
      ) : (
        <DayView
          {...view}
          day={day}
          leader={leader}
          meetings={meetings}
          attendedTotal={schedule.attended_total}
          specialistsCount={schedule.specialists_count}
        />
      )}
    </>
  );
}
