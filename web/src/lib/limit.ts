import type { Schemas } from "./api/client";

type Plan = Schemas["PlanStatus"];

export const peoplePath = "/app/people";
export const newClientPath = peoplePath + "/clients/new";

export function activeClientLimitReached(plan: Plan): boolean {
  return (
    plan.kind === "free" && plan.client_limit !== null && plan.active_clients >= plan.client_limit
  );
}

export function limitScreenHref(
  ...[reason, target]: ["new_client", { returnTo: string }] | ["restore", { clientId: string }]
): string {
  const query = new URLSearchParams({ reason });
  if (reason === "restore") query.set("client_id", target.clientId);
  else query.set("returnTo", target.returnTo);
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
