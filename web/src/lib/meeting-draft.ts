import type { Schemas } from "./api/client";
import { meetingTypeLabels } from "./meeting-display";

type Card = Schemas["ClientCard"];
type Outcome = Schemas["MeetingOutcomeStatus"];

export interface OutcomeDraft {
  status: Outcome;
  duration: string;
  price: string;
  paymentType: Schemas["PaymentType"] | null;
  charged: boolean | null;
}

export interface MeetingDraft {
  type: Schemas["MeetingType"];
  client: Pick<Card, "id" | "name" | "currency" | "photo_url" | "rate" | "payment_type"> | null;
  withWhom: string;
  topic: string;
  date: string;
  start: string;
  duration: string;
  myDuration: string;
  place: Schemas["MeetingPlace"];
  link: string;
  address: string;
  price: string;
  currency: Schemas["Currency"];
  currencyPicked: boolean;
  paymentType: Schemas["PaymentType"] | null;
  comment: string;
  outcome: OutcomeDraft | null;
}

interface SavedDraft {
  owner: string;
  route: string;
  values: MeetingDraft;
}

const draftKey = "celmento_meeting_form_draft_v1";

const textFields = [
  "withWhom",
  "topic",
  "date",
  "start",
  "duration",
  "myDuration",
  "link",
  "address",
  "price",
  "comment",
] as const satisfies readonly (keyof MeetingDraft)[];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTextOrNull(value: unknown): boolean {
  return value === null || typeof value === "string";
}

function isCurrency(value: unknown): boolean {
  return value === "RUB" || value === "EUR" || value === "USD";
}

function isPaymentType(value: unknown): boolean {
  return value === "paid" || value === "barter" || value === "pro_bono";
}

function isClient(value: unknown): boolean {
  return (
    value === null ||
    (isRecord(value) &&
      typeof value.id === "string" &&
      typeof value.name === "string" &&
      isCurrency(value.currency) &&
      isTextOrNull(value.photo_url) &&
      isTextOrNull(value.rate) &&
      isPaymentType(value.payment_type))
  );
}

function isOutcome(value: unknown): boolean {
  return (
    value === null ||
    (isRecord(value) &&
      (value.status === "completed" || value.status === "not_taken_place") &&
      typeof value.duration === "string" &&
      typeof value.price === "string" &&
      (value.paymentType === null || isPaymentType(value.paymentType)) &&
      (value.charged === null || typeof value.charged === "boolean"))
  );
}

function isSavedDraft(value: unknown): value is SavedDraft {
  if (!isRecord(value) || typeof value.owner !== "string" || typeof value.route !== "string")
    return false;
  const draft = value.values;
  return (
    isRecord(draft) &&
    textFields.every((field) => typeof draft[field] === "string") &&
    typeof draft.type === "string" &&
    Object.hasOwn(meetingTypeLabels, draft.type) &&
    (draft.place === "online" || draft.place === "in_person") &&
    isCurrency(draft.currency) &&
    typeof draft.currencyPicked === "boolean" &&
    (draft.paymentType === null || isPaymentType(draft.paymentType)) &&
    isClient(draft.client) &&
    isOutcome(draft.outcome)
  );
}

export function saveDraft(owner: string, route: string, values: MeetingDraft): boolean {
  try {
    sessionStorage.setItem(draftKey, JSON.stringify({ owner, route, values } satisfies SavedDraft));
    return true;
  } catch {
    return false;
  }
}

export function loadDraft(owner: string, route: string): MeetingDraft | null {
  try {
    const saved = sessionStorage.getItem(draftKey);
    if (!saved) return null;
    const decoded: unknown = JSON.parse(saved);
    if (!isSavedDraft(decoded)) {
      sessionStorage.removeItem(draftKey);
      return null;
    }
    return decoded.owner === owner && decoded.route === route ? decoded.values : null;
  } catch {
    return null;
  }
}

export function clearDraft(owner: string, route: string): void {
  if (!loadDraft(owner, route)) return;
  try {
    sessionStorage.removeItem(draftKey);
  } catch {
    return;
  }
}
