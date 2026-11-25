import { isZeroClientRate } from "@/components/clients/PaymentTypeChips";
import { normalizeClientRate, validRateInput } from "@/components/clients/RateCurrencyFields";
import type { Schemas } from "@/lib/api/client";
import type { MeetingDraft } from "@/lib/meeting-draft";
import { zonedClock, zonedDay, zonedInstant } from "@/lib/zoned-date";
import { minutes } from "./DurationField";
import { outcomeInput } from "./OutcomeFields";

type Card = Schemas["ClientCard"];
type Detail = Schemas["MeetingDetail"];
type Account = Schemas["Account"];
type Create = Schemas["MeetingCreate"];

export function initialDraft(
  timeZone: string,
  defaults: Schemas["MeetingDefaults"],
  card: Card | null,
): MeetingDraft {
  const price = card?.rate ?? "0";
  const payment = card?.payment_type ?? "paid";
  return {
    type: "client_session",
    client: card
      ? {
          id: card.id,
          name: card.name,
          currency: card.currency,
          photo_url: card.photo_url,
          rate: card.rate,
          payment_type: card.payment_type,
        }
      : null,
    withWhom: "",
    topic: "",
    date: zonedDay(defaults.starts_at, timeZone),
    start: zonedClock(defaults.starts_at, timeZone),
    duration: String(defaults.duration_minutes),
    myDuration: "",
    place: "online",
    link: defaults.meeting_link ?? "",
    address: "",
    price: card ? price : "",
    currency: card?.currency ?? defaults.currency,
    currencyPicked: false,
    paymentType: card && !(isZeroClientRate(price) && payment === "paid") ? payment : null,
    comment: "",
    outcome: null,
  };
}

export function editableDraft(account: Account, meeting: Detail): MeetingDraft {
  const card = meeting.client_card;
  return {
    type: meeting.type,
    client: card
      ? {
          id: card.id,
          name: card.name,
          currency: card.currency,
          photo_url: card.photo_url,
          rate: card.rate,
          payment_type: card.payment_type,
        }
      : null,
    withWhom: meeting.with_whom ?? "",
    topic: meeting.topic ?? "",
    date: zonedDay(meeting.starts_at, account.time_zone),
    start: zonedClock(meeting.starts_at, account.time_zone),
    duration: String(meeting.duration_minutes),
    myDuration: meeting.my_duration_minutes?.toString() ?? "",
    place: meeting.place,
    link: meeting.meeting_link ?? "",
    address: meeting.address ?? "",
    price: meeting.price?.amount ?? "",
    currency:
      meeting.price?.currency ?? card?.currency ?? account.leader?.default_currency ?? "RUB",
    currencyPicked: true,
    paymentType: meeting.payment_type,
    comment: meeting.comment ?? "",
    outcome: null,
  };
}

export function meetingStart(
  draft: MeetingDraft,
  timeZone: string,
  original?: Detail,
): string | null {
  if (
    original &&
    draft.date === zonedDay(original.starts_at, timeZone) &&
    draft.start === zonedClock(original.starts_at, timeZone)
  )
    return original.starts_at;

  return zonedInstant(draft.date, draft.start, timeZone);
}

export function meetingPayload(
  draft: MeetingDraft,
  startsAt: string | null,
  showOutcome: boolean,
): Create | null {
  const duration = minutes(draft.duration);
  const mutual = draft.type === "mutual_practice";
  const client = draft.type === "client_session";
  const myDuration = minutes(draft.myDuration);
  const price = normalizeClientRate(draft.price);
  const maybeOutcome =
    draft.outcome?.status === "not_taken_place"
      ? { ...draft.outcome, paymentType: draft.paymentType }
      : draft.outcome;
  const enteredOutcome =
    showOutcome && maybeOutcome ? outcomeInput(maybeOutcome, draft.type) : null;

  if (
    !startsAt ||
    duration === null ||
    (mutual && (myDuration === null || myDuration > duration)) ||
    (!mutual && (price === null || !validRateInput(draft.price))) ||
    (client &&
      (!draft.client ||
        !draft.paymentType ||
        (isZeroClientRate(draft.price) && draft.paymentType === "paid"))) ||
    (showOutcome && maybeOutcome && !enteredOutcome)
  )
    return null;

  const body: Create = {
    type: draft.type,
    starts_at: startsAt,
    duration_minutes: duration,
    place: draft.place,
    comment: draft.comment || null,
    allow_overlap: false,
  };
  if (draft.place === "online") body.meeting_link = draft.link.trim() || null;
  else body.address = draft.address.trim() || null;
  if (client && draft.client && price !== null && draft.paymentType) {
    body.client_id = draft.client.id;
    body.price = price;
    body.payment_type = draft.paymentType;
  } else {
    body.with_whom = draft.withWhom.trim() || null;
    body.topic = draft.topic.trim() || null;
    if (mutual && myDuration !== null) body.my_duration_minutes = myDuration;
    else if (price !== null) {
      body.price = price;
      body.currency = draft.currency;
    }
  }
  // spec:impl meeting-form#run-completed-not-taken-place-flow
  if (enteredOutcome) body.outcome = enteredOutcome;
  return body;
}
