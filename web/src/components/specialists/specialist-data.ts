"use client";

import { useCallback, useEffect, useState } from "react";
import { useAccount } from "@/lib/account";
import { apiClient, errorCode, type Schemas } from "@/lib/api/client";
import { subscribeVisibleRevalidation } from "@/lib/visible-revalidation";

type Request<T> = (
  token: string,
  signal: AbortSignal,
) => Promise<{ data?: T; error?: unknown; response: Response }>;

type Result<T> =
  | { kind: "ready"; data: T }
  | { kind: "missing" | "offline" | "error" }
  | { kind: "unavailable"; error: unknown };

interface SpecialistResource<T> {
  result: Result<T> | null;
  retry: () => void;
}

interface ResourceSnapshot<T> {
  accountId: string;
  request: Request<T>;
  attempt: number;
  result: Result<T>;
}

const unavailableStatuses = [401, 403, 404, 422];

function useResource<T>(
  request: Request<T>,
  { enabled = true, live = true }: { enabled?: boolean; live?: boolean } = {},
): SpecialistResource<T> {
  const { account, currentSessionToken } = useAccount();
  const accountId = account.id;
  const [snapshot, setSnapshot] = useState<ResourceSnapshot<T> | null>(null);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((old) => old + 1), []);

  useEffect(() => {
    if (!enabled) return;

    const token = currentSessionToken();
    if (!token) return;

    let pending: AbortController | null = null;
    let loaded = false;
    const identity = { accountId, attempt, request };

    async function load(session: string): Promise<void> {
      if (pending || currentSessionToken() !== session) return;
      const controller = new AbortController();
      pending = controller;

      function show(result: Result<T>): void {
        loaded = result.kind === "ready";
        setSnapshot({ ...identity, result });
      }

      try {
        const { data, error, response } = await request(session, controller.signal);
        if (controller.signal.aborted || currentSessionToken() !== session) return;

        if (data !== undefined) show({ kind: "ready", data });
        else if (unavailableStatuses.includes(response.status)) show({ kind: "missing" });
        else if (response.status === 409 && errorCode(error) === "booking_unavailable")
          show({ kind: "unavailable", error });
        else if (!loaded) show({ kind: "error" });
      } catch {
        if (!loaded && !controller.signal.aborted && currentSessionToken() === session) {
          show({ kind: "offline" });
        }
      } finally {
        pending = null;
      }
    }

    void load(token);
    const unsubscribe = live ? subscribeVisibleRevalidation(() => void load(token)) : undefined;

    return () => {
      unsubscribe?.();
      pending?.abort();
    };
  }, [accountId, attempt, currentSessionToken, enabled, live, request]);

  const result =
    enabled &&
    snapshot?.accountId === accountId &&
    snapshot.request === request &&
    snapshot.attempt === attempt
      ? snapshot.result
      : null;
  return { result, retry };
}

const listSpecialists: Request<Schemas["SpecialistList"]> = (token, signal) =>
  apiClient(token).GET("/specialists", { signal, cache: "no-store" });

export function useSpecialists(): SpecialistResource<Schemas["SpecialistList"]> {
  return useResource(listSpecialists);
}

export function readSpecialist(
  token: string,
  specialistId: string,
  signal?: AbortSignal,
): Promise<{ data?: Schemas["SpecialistCard"]; response: Response }> {
  return apiClient(token).GET("/specialists/{specialist_id}", {
    params: { path: { specialist_id: specialistId } },
    signal,
    cache: "no-store",
  });
}

export function useSpecialist(
  specialistId: string,
  options?: { enabled?: boolean; live?: boolean },
): SpecialistResource<Schemas["SpecialistCard"]> {
  const request = useCallback<Request<Schemas["SpecialistCard"]>>(
    (token, signal) => readSpecialist(token, specialistId, signal),
    [specialistId],
  );
  return useResource(request, options);
}

export function useSpecialistSlots(
  specialistId: string,
  day: string,
  timeZone: string,
  enabled: boolean,
): SpecialistResource<Schemas["BookingSlotList"]> {
  const request = useCallback<Request<Schemas["BookingSlotList"]>>(
    (token, signal) =>
      apiClient(token).GET("/specialists/{specialist_id}/slots", {
        params: {
          path: { specialist_id: specialistId },
          query: { from: day, to: day, time_zone: timeZone },
        },
        signal,
        cache: "no-store",
      }),
    [day, specialistId, timeZone],
  );
  return useResource(request, { enabled, live: false });
}

export function useAttendedMeeting(
  meetingId: string,
): SpecialistResource<Schemas["AttendedMeeting"]> {
  const request = useCallback<Request<Schemas["AttendedMeeting"]>>(
    (token, signal) =>
      apiClient(token).GET("/attended-meetings/{meeting_id}", {
        params: { path: { meeting_id: meetingId } },
        signal,
        cache: "no-store",
      }),
    [meetingId],
  );
  return useResource(request);
}

export async function unlinkSpecialist(
  specialistId: string,
  currentSessionToken: () => string | null,
): Promise<void> {
  const session = currentSessionToken();
  if (!session) throw new Error("No active session.");

  const { response } = await apiClient(session).DELETE("/specialists/{specialist_id}/link", {
    params: { path: { specialist_id: specialistId } },
  });
  if (currentSessionToken() !== session || (!response.ok && response.status !== 404))
    throw new Error("The specialist could not be unlinked.");
}

export async function loadAttendedCalendar(
  meetingId: string,
  currentSessionToken: () => string | null,
  signal: AbortSignal,
): Promise<{ data?: Blob; response: Response }> {
  const session = currentSessionToken();
  if (!session) throw new Error("No active session.");

  const result = await apiClient(session).GET("/attended-meetings/{meeting_id}/calendar.ics", {
    params: { path: { meeting_id: meetingId } },
    parseAs: "blob",
    cache: "no-store",
    signal,
  });
  if (currentSessionToken() !== session) throw new Error("The session has changed.");
  return result;
}
