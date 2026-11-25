"use client";

import { useCallback, useEffect, useState } from "react";
import { apiClient, type Schemas } from "@/lib/api/client";

type Load<T> = (signal: AbortSignal) => Promise<{ data?: T; response: Response }>;
type Result<T> = { kind: "ready"; data: T } | { kind: "missing" | "error" | "offline" };

interface Resource<T> {
  result: Result<T> | null;
  retry: () => void;
}

export function usePublicResource<T>(load: Load<T>, enabled = true): Resource<T> {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{
    load: Load<T>;
    attempt: number;
    result: Result<T>;
  } | null>(null);
  const current =
    enabled && result?.load === load && result.attempt === attempt ? result.result : null;

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();

    async function fetchResource(): Promise<void> {
      try {
        const { data, response } = await load(controller.signal);
        if (controller.signal.aborted) return;
        const result: Result<T> = data
          ? { kind: "ready", data }
          : { kind: response.status === 404 || response.status === 422 ? "missing" : "error" };
        setResult({ load, attempt, result });
      } catch {
        if (!controller.signal.aborted) setResult({ load, attempt, result: { kind: "offline" } });
      }
    }

    void fetchResource();
    return () => controller.abort();
  }, [attempt, enabled, load]);

  return { result: current, retry: () => setAttempt((value) => value + 1) };
}

export function usePublicSpecialist(login: string): Resource<Schemas["PublicSpecialistPage"]> {
  const load = useCallback(
    (signal: AbortSignal) =>
      // spec:impl public-booking-page#resolve-login-only-accounts-contour
      // spec:impl public-booking-page#look-up-login-other-contour
      apiClient(null).GET("/public/specialists/{login}", {
        params: { path: { login } },
        signal,
        cache: "no-store",
      }),
    [login],
  );
  return usePublicResource(load);
}

export function usePublicSlots(
  login: string,
  day: string,
  timeZone: string,
): Resource<Schemas["BookingSlotList"]> {
  const load = useCallback(
    (signal: AbortSignal) =>
      // spec:impl public-booking-page#compute-slots-leader-current-working
      apiClient(null).GET("/public/specialists/{login}/slots", {
        params: { path: { login }, query: { from: day, to: day, time_zone: timeZone } },
        signal,
        cache: "no-store",
      }),
    [day, login, timeZone],
  );
  return usePublicResource(load);
}
