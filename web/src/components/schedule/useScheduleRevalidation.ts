"use client";

import { useEffect } from "react";
import type { Schemas } from "@/lib/api/client";

export function useScheduleRevalidation(
  schedule: Pick<Schemas["MeetingList"], "next_outcome_in_seconds"> | null,
  refresh: () => void,
): void {
  useEffect(() => {
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    // spec:impl pending-outcomes#show-need-outcome-bar-n-equal-number
    const seconds = schedule?.next_outcome_in_seconds;
    const timer =
      seconds == null
        ? undefined
        : window.setTimeout(refresh, Math.min(seconds * 1000, 2_147_483_647));
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [schedule, refresh]);
}
