"use client";

import { useCallback, useEffect, useState } from "react";
import { useAccount } from "@/lib/account";
import { apiClient, type Schemas } from "@/lib/api/client";
import type { MessageKey } from "@/lib/i18n";
import { periodQuery } from "@/lib/records-period";
import { subscribeVisibleRevalidation } from "@/lib/visible-revalidation";

type Period = Schemas["RecordsPeriod"];
type RecordsRequest<T> = (
  api: ReturnType<typeof apiClient>,
  signal: AbortSignal,
) => Promise<{ data?: T; response: Response }>;

interface RecordsResource<T> {
  data: T | null;
  error: MessageKey | null;
  retry: () => void;
}

type Result<T> = { data: T; error: null } | { data: null; error: MessageKey };
interface Snapshot<T> {
  accountId: string;
  timeZone: string;
  attempt: number;
  request: RecordsRequest<T>;
  result: Result<T>;
}

function useRecordsResource<T>(request: RecordsRequest<T>, live = true): RecordsResource<T> {
  const { account, currentSessionToken } = useAccount();
  const accountId = account.id;
  const timeZone = account.time_zone;
  const [snapshot, setSnapshot] = useState<Snapshot<T> | null>(null);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((previous) => previous + 1), []);

  useEffect(() => {
    const session = currentSessionToken();
    if (!session) return;
    const identity = { accountId, timeZone, attempt, request };
    let pending: AbortController | null = null;
    let loaded = false;

    async function load(token: string): Promise<void> {
      if (pending || currentSessionToken() !== token) return;
      const controller = new AbortController();
      pending = controller;
      const { signal } = controller;
      try {
        const { data, response } = await request(apiClient(token), signal);
        if (signal.aborted || currentSessionToken() !== token) return;
        if (data !== undefined) {
          loaded = true;
          setSnapshot({ ...identity, result: { data, error: null } });
        } else if (!loaded || response.status === 401 || response.status === 403) {
          loaded = false;
          setSnapshot({ ...identity, result: { data: null, error: "extra.auth_request_failed" } });
        }
      } catch {
        if (!loaded && !signal.aborted && currentSessionToken() === token) {
          setSnapshot({ ...identity, result: { data: null, error: "extra.auth_network_error" } });
        }
      } finally {
        pending = null;
      }
    }

    void load(session);
    const unsubscribe = live ? subscribeVisibleRevalidation(() => void load(session)) : null;
    return () => {
      unsubscribe?.();
      pending?.abort();
    };
  }, [accountId, attempt, currentSessionToken, live, request, timeZone]);

  const result =
    snapshot?.accountId === accountId &&
    snapshot.timeZone === timeZone &&
    snapshot.request === request &&
    snapshot.attempt === attempt
      ? snapshot.result
      : null;
  return { data: result?.data ?? null, error: result?.error ?? null, retry };
}

export function useRecordsSummary(period: Period): RecordsResource<Schemas["RecordsSummary"]> {
  const request = useCallback<RecordsRequest<Schemas["RecordsSummary"]>>(
    (api, signal) =>
      api.GET("/records/summary", {
        params: { query: periodQuery(period) },
        signal,
        cache: "no-store",
      }),
    [period],
  );
  // spec:impl accounting-summary#reflect-recorded-changed-outcome-edited
  return useRecordsResource(request);
}

export function useRecordsOperations(
  period: Period,
  filter: Schemas["RecordsOperationFilter"],
): RecordsResource<Schemas["RecordsOperationList"]> {
  const request = useCallback<RecordsRequest<Schemas["RecordsOperationList"]>>(
    (api, signal) =>
      api.GET("/records/operations", {
        params: { query: { ...periodQuery(period), kind: filter } },
        signal,
        cache: "no-store",
      }),
    [filter, period],
  );
  return useRecordsResource(request);
}

export function useRecordsHours(
  period: Period,
  type: Schemas["RecordsHoursLogType"],
): RecordsResource<Schemas["RecordsHoursLog"]> {
  const request = useCallback<RecordsRequest<Schemas["RecordsHoursLog"]>>(
    (api, signal) =>
      api.GET("/records/hours", {
        params: { query: { ...periodQuery(period), type } },
        signal,
        cache: "no-store",
      }),
    [period, type],
  );
  // spec:impl hours-log#update-totals-breakdown-list-immediately
  return useRecordsResource(request);
}

export function useRecordsHoursExport(
  period: Period,
  type: Schemas["RecordsHoursLogType"],
  format: Schemas["RecordsHoursExportFormat"],
): RecordsResource<File> {
  const request = useCallback<RecordsRequest<File>>(
    async (api, signal) => {
      const { data, response } = await api.GET("/records/hours/export", {
        params: { query: { ...periodQuery(period), type, format } },
        parseAs: "arrayBuffer",
        signal,
        cache: "no-store",
      });
      if (!data || !response.ok) return { response };
      const header = response.headers.get("Content-Disposition");
      const filename = /(?:^|;)\s*filename="?([a-z0-9_-]+\.csv)"?(?:;|$)/iu.exec(header ?? "")?.[1];
      const suffix = period.kind === "custom" ? `${period.from}_${period.to}` : period.kind;
      const fallback = `celmento_${type}_${suffix}.csv`;
      return { data: new File([data], filename ?? fallback, { type: "text/csv" }), response };
    },
    [format, period, type],
  );
  return useRecordsResource(request, false);
}

const balances: RecordsRequest<Schemas["RecordsBalanceList"]> = (api, signal) =>
  api.GET("/records/balances", { signal, cache: "no-store" });

export function useRecordsBalances(): RecordsResource<Schemas["RecordsBalanceList"]> {
  return useRecordsResource(balances);
}
