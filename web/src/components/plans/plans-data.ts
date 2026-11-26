"use client";

import { useEffect, useRef, useState } from "react";
import { useAccount } from "@/lib/account";
import { apiClient, errorCode, type Schemas } from "@/lib/api/client";
import type { MessageKey } from "@/lib/i18n";
import { subscribeVisibleRevalidation } from "@/lib/visible-revalidation";

type Result<T> = { data: T; error: null } | { data: null; error: MessageKey };
type Request<T> = (session: string) => Promise<{ data?: T; response: Response }>;

interface InitialRead<T> {
  session: string;
  promise: Promise<Result<T>>;
}

async function readScreen<T>(request: Request<T>, session: string): Promise<Result<T>> {
  try {
    const { data } = await request(session);
    if (data !== undefined) return { data, error: null };
    return { data: null, error: "extra.auth_request_failed" };
  } catch {
    return { data: null, error: "extra.auth_network_error" };
  }
}

function useScreenRequest<T>(request: Request<T>, enabled: boolean): Result<T> | null {
  const { currentSessionToken } = useAccount();
  const started = useRef<InitialRead<T> | null>(null);
  const [result, setResult] = useState<Result<T> | null>(null);

  useEffect(() => {
    const session = currentSessionToken();
    if (!enabled || !session) return;
    let active = true;
    if (started.current?.session !== session) {
      // A Strict Mode effect replay observes the original request and its analytics event.
      started.current = { session, promise: readScreen(request, session) };
    }
    void started.current.promise.then((response) => {
      if (active && currentSessionToken() === session) setResult(response);
    });
    return () => {
      active = false;
    };
  }, [currentSessionToken, enabled, request]);

  return enabled ? result : null;
}

const getPlans: Request<Schemas["PlansOverview"]> = (session) =>
  apiClient(session).GET("/plans", { cache: "no-store" });

const confirmLimit: Request<Schemas["PlanStatus"]> = (session) =>
  apiClient(session).POST("/plans/limit-hits");

export function usePlansOverview(): Result<Schemas["PlansOverview"]> | null {
  return useScreenRequest(getPlans, true);
}

export function useLimitConfirmation(enabled: boolean): Result<Schemas["PlanStatus"]> | null {
  return useScreenRequest(confirmLimit, enabled);
}

export function useApplyPlanStatus(plan: Schemas["PlanStatus"] | null): boolean {
  const { account, refresh } = useAccount();
  const [initial] = useState(() => account.leader?.plan);
  const handled = useRef<Schemas["PlanStatus"] | null>(null);
  const current = account.leader?.plan;
  const applied =
    plan !== null && current !== undefined && (current === plan || current !== initial);

  useEffect(() => {
    if (!plan || !account.leader || handled.current === plan) return;
    handled.current = plan;
    if (!applied) void refresh({ ...account, leader: { ...account.leader, plan } });
  }, [account, applied, plan, refresh]);

  return applied;
}

export function useLivePlan(enabled: boolean): void {
  const { currentSessionToken, refresh } = useAccount();

  useEffect(() => {
    const session = currentSessionToken();
    if (!enabled || !session) return;

    let pending = false;
    return subscribeVisibleRevalidation(() => {
      if (pending || currentSessionToken() !== session) return;
      pending = true;
      void refresh().finally(() => {
        pending = false;
      });
    });
  }, [currentSessionToken, enabled, refresh]);
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function existingSubscriptionRequest(
  error: unknown,
  currency: Schemas["Currency"],
): Schemas["SubscriptionRequest"] | null {
  if (
    !record(error) ||
    errorCode(error) !== "subscription_request_exists" ||
    !record(error.details) ||
    !record(error.details.request)
  )
    return null;

  const { created_at, level, source, term } = error.details.request;
  if (
    (term !== "month" && term !== "year") ||
    (source !== "limit_screen" && source !== "profile") ||
    (level !== "base" && level !== "promo" && level !== "partner") ||
    error.details.request.currency !== currency ||
    typeof created_at !== "string" ||
    !Number.isFinite(Date.parse(created_at))
  )
    return null;

  return { created_at, level, source, term, currency };
}
