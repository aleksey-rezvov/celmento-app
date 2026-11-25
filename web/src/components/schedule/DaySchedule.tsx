"use client";

import { useCallback, useEffect, useState, type ReactElement } from "react";
import type { Schemas } from "@/lib/api/client";
import { useTranslation } from "@/lib/i18n";
import { DayView } from "./DayView";
import { listScheduledMeetings } from "./schedule-data";
import { useScheduleRevalidation } from "./useScheduleRevalidation";

interface DayScheduleProps {
  day: string;
  leader: boolean;
  now: Date;
  onMove: (distance: number) => void;
  onCreateAt: (startsAt: string) => void;
  onOpen: (id: string) => void;
  onPendingCount: (count: number) => void;
}

export function DaySchedule({ day, onPendingCount, ...view }: DayScheduleProps): ReactElement {
  const t = useTranslation();
  const [schedule, setSchedule] = useState<Schemas["MeetingList"] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const refresh = useCallback(() => setAttempt((value) => value + 1), []);
  useScheduleRevalidation(schedule, refresh);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    void listScheduledMeetings({ from: day, to: day }, signal).then(
      (data) => {
        if (!signal.aborted) {
          setSchedule(data);
          setFailed(false);
          onPendingCount(data.pending_outcomes_count);
        }
      },
      () => {
        if (!signal.aborted) setFailed(true);
      },
    );
    return () => controller.abort();
  }, [attempt, day, onPendingCount]);

  return (
    <>
      {failed && (
        <div role="alert" className="schedule-error">
          <p>{t("extra.auth_request_failed")}</p>
          <button className="shell-secondary" type="button" onClick={refresh}>
            {t("extra.auth_retry")}
          </button>
        </div>
      )}
      {schedule === null ? (
        <div aria-busy={!failed} />
      ) : (
        <DayView {...view} day={day} meetings={schedule.items} />
      )}
    </>
  );
}
