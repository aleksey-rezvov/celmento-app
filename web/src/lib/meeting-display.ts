import type { Schemas } from "./api/client";
import type { MessageKey, Translate } from "./i18n/messages";

export const meetingTypeLabels = {
  client_session: "form.type_session",
  personal_therapy: "form.type_therapy",
  supervision: "form.type_supervision",
  mutual_practice: "form.type_mutual",
  training: "form.type_training",
} as const satisfies Record<Schemas["MeetingType"], MessageKey>;

export const meetingStatusLabels = {
  scheduled: "card.status_planned",
  completed: "card.status_done",
  not_taken_place: "card.status_missed",
} as const satisfies Record<Schemas["MeetingStatus"], MessageKey>;

type Summary = Pick<Schemas["Meeting"], "type" | "client" | "with_whom">;

export function meetingTitle(meeting: Summary, t: Translate): string {
  if (meeting.client) return meeting.client.name;
  const type = t(meetingTypeLabels[meeting.type]);
  return meeting.with_whom ? type + " · " + meeting.with_whom : type;
}

export function meetingPerson(meeting: Summary, t: Translate): string {
  return meeting.client?.name || meeting.with_whom || t(meetingTypeLabels[meeting.type]);
}
