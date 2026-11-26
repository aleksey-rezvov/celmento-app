import type { Schemas } from "@/lib/api/client";
import { limitReturnPath, limitScreenHref } from "@/lib/limit";

export const plansPath = "/app/plans";
export const plansSentPath = plansPath + "/sent";
export const profilePlansHref = plansPath + "?source=profile";

export function fromLimitHref(limit: string): string {
  return plansPath + "?" + new URLSearchParams({ source: "limit_screen", limit }).toString();
}

interface PlansEntry {
  source: Schemas["SubscriptionRequestSource"];
  back: string;
  href: string;
}

export function plansEntry(query: Pick<URLSearchParams, "get">): PlansEntry {
  const limit = query.get("limit");
  if (query.get("source") === "limit_screen" && limit?.startsWith("/app/limit?")) {
    const { searchParams } = new URL(limit, "https://celmento.invalid");
    const reason = searchParams.get("reason");
    const clientId = searchParams.get("client_id");
    const back =
      reason === "restore" && clientId
        ? limitScreenHref("restore", { clientId })
        : limitScreenHref("new_client", {
            returnTo: limitReturnPath(searchParams.get("returnTo")),
          });
    return { source: "limit_screen", back, href: fromLimitHref(back) };
  }

  return { source: "profile", back: "/app/profile", href: profilePlansHref };
}
