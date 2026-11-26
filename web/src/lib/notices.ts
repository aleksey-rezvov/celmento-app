import { apiClient, type Schemas } from "@/lib/api/client";

export async function listAccountNotices(
  session: string,
  signal: AbortSignal,
): Promise<Schemas["Notice"][] | null> {
  const { data } = await apiClient(session).GET("/notices", { signal, cache: "no-store" });
  return data?.items ?? null;
}
