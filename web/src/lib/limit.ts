import type { Schemas } from "./api/client";

type Plan = Schemas["PlanStatus"];
type LimitReason = "new_client" | "restore";

export const peoplePath = "/app/people";
export const newClientPath = peoplePath + "/clients/new";

export function activeClientLimitReached(plan: Plan): boolean {
  return (
    plan.kind === "free" && plan.client_limit !== null && plan.active_clients >= plan.client_limit
  );
}

export function limitScreenHref(
  reason: LimitReason,
  { returnTo, clientName }: { returnTo: string; clientName?: string },
): string {
  const query = new URLSearchParams({ reason, returnTo });
  if (clientName !== undefined) query.set("clientName", clientName);
  return "/app/limit?" + query.toString();
}

export function newClientHref(plan: Plan | undefined): string {
  return plan && activeClientLimitReached(plan)
    ? limitScreenHref("new_client", { returnTo: peoplePath })
    : newClientPath;
}

export function limitReturnPath(returnTo: string | null): string {
  if (!returnTo?.startsWith("/app/")) return peoplePath;

  const base = "https://celmento.invalid";
  const result = new URL(returnTo, base);
  return result.origin === base &&
    result.pathname.startsWith("/app/") &&
    result.pathname !== "/app/limit"
    ? result.pathname + result.search + result.hash
    : peoplePath;
}
