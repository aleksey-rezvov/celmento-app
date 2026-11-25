"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

export type ScheduleView = "schedule" | "day";

const preferenceKey = "celmento_app_schedule_view";

export function loadView(): ScheduleView {
  try {
    if (typeof window !== "undefined" && window.localStorage.getItem(preferenceKey) === "day")
      return "day";
  } catch {
    // An unavailable preference store falls back to the schedule.
  }
  return "schedule";
}

export function saveView(view: ScheduleView): void {
  try {
    window.localStorage.setItem(preferenceKey, view);
  } catch {
    // The current tab can still switch views without the preference store.
  }
}

let creationDay: string | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function publish(day: string | null): void {
  if (creationDay !== day) {
    creationDay = day;
    for (const listener of listeners) listener();
  }
}

export function useSetMeetingCreationDay(day: string): void {
  useEffect(() => {
    publish(day);
    return () => publish(null);
  }, [day]);
}

export function useMeetingCreationDay(): string | null {
  return useSyncExternalStore(
    subscribe,
    () => creationDay,
    () => null,
  );
}

export function meetingCreationHref(day: string, startsAt?: string): string {
  const query = new URLSearchParams({ date: day });
  if (startsAt) query.set("starts_at", startsAt);
  return "/app/meetings/new?" + query.toString();
}

export function useCurrentInstant(): Date {
  const [instant, setInstant] = useState(() => new Date());
  useEffect(() => {
    let timer: number;
    function schedule(): void {
      timer = window.setTimeout(
        () => {
          setInstant(new Date());
          schedule();
        },
        60_000 - (Date.now() % 60_000),
      );
    }

    function refresh(): void {
      window.clearTimeout(timer);
      setInstant(new Date());
      schedule();
    }

    schedule();
    window.addEventListener("focus", refresh);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("focus", refresh);
    };
  }, []);
  return instant;
}
