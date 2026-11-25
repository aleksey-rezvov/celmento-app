import { apiClient, type Schemas } from "./api/client";
import { getSessionToken } from "./session";

export async function putMeetingOutcome(
  id: string,
  body: Schemas["MeetingOutcomeInput"],
): Promise<Schemas["MeetingDetail"] | null> {
  const { data } = await apiClient(getSessionToken()).PUT("/meetings/{meeting_id}/outcome", {
    params: { path: { meeting_id: id } },
    body,
  });
  return data ?? null;
}
