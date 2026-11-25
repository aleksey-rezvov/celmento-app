"use client";

import { useParams } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type Dispatch,
  type ReactElement,
  type ReactNode,
  type SetStateAction,
} from "react";
import type { Schemas } from "@/lib/api/client";
import { useIdempotencyKey } from "@/lib/idempotency";

type Confirmation = Schemas["GuestBookingConfirmation"];

export interface BookingFormValues {
  name: string;
  email: string;
  contact: string;
  comment: string;
  place: Schemas["MeetingPlace"] | null;
}

export interface BookingDraft {
  startsAt: string | null;
  bookingContext: string | null;
  values: BookingFormValues;
  termsVersion: string | null;
  privacyVersion: string | null;
}

type BookingOutcome =
  { kind: "slot_taken" | "unavailable" } | { kind: "booked"; confirmation: Confirmation };

interface BookingSessionState {
  draft: BookingDraft;
  outcome: BookingOutcome | null;
}

interface BookingSessionValue {
  login: string;
  state: BookingSessionState;
  update: Dispatch<SetStateAction<BookingSessionState>>;
  idempotency: ReturnType<typeof useIdempotencyKey>;
}

const BookingContext = createContext<BookingSessionValue | null>(null);

export const emptyBookingDraft: BookingDraft = {
  startsAt: null,
  bookingContext: null,
  values: { name: "", email: "", contact: "", comment: "", place: null },
  termsVersion: null,
  privacyVersion: null,
};

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? Object.fromEntries(Object.entries(value)) : {};
}

function place(value: unknown): Schemas["MeetingPlace"] | null {
  return value === "online" || value === "in_person" ? value : null;
}

function instant(value: unknown): string | null {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null;
}

function restoredOutcome(value: unknown): BookingOutcome | null {
  const outcome = object(value);
  if (outcome.kind === "slot_taken" || outcome.kind === "unavailable")
    return { kind: outcome.kind };
  if (outcome.kind !== "booked") return null;

  const data = object(outcome.confirmation);
  const startsAt = instant(data.starts_at);
  const meetingPlace = place(data.place);
  if (
    typeof data.id !== "string" ||
    typeof data.specialist_name !== "string" ||
    typeof data.email !== "string" ||
    !startsAt ||
    !meetingPlace
  )
    return null;

  return {
    kind: "booked",
    confirmation: {
      id: data.id,
      specialist_name: data.specialist_name,
      email: data.email,
      starts_at: startsAt,
      place: meetingPlace,
      meeting_link: typeof data.meeting_link === "string" ? data.meeting_link : null,
    },
  };
}

function storedSession(key: string): BookingSessionState {
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return { draft: emptyBookingDraft, outcome: null };
    const state = object(JSON.parse(raw));
    const draft = object(state.draft);
    const values = object(draft.values);
    return {
      draft: {
        startsAt: instant(draft.startsAt),
        bookingContext: typeof draft.bookingContext === "string" ? draft.bookingContext : null,
        termsVersion: typeof draft.termsVersion === "string" ? draft.termsVersion : null,
        privacyVersion: typeof draft.privacyVersion === "string" ? draft.privacyVersion : null,
        values: {
          name: typeof values.name === "string" ? values.name : "",
          email: typeof values.email === "string" ? values.email : "",
          contact: typeof values.contact === "string" ? values.contact : "",
          comment: typeof values.comment === "string" ? values.comment : "",
          place: place(values.place),
        },
      },
      outcome: restoredOutcome(state.outcome),
    };
  } catch {
    return { draft: emptyBookingDraft, outcome: null };
  }
}

function BookingSession({ login, children }: { login: string; children: ReactNode }): ReactElement {
  const key = "celmento_app_guest_booking:" + login;
  const [state, setState] = useState(() => storedSession(key));
  const latest = useRef(state);
  const idempotency = useIdempotencyKey(key + ":attempt");

  const update = useCallback(
    (action: SetStateAction<BookingSessionState>) => {
      const next = typeof action === "function" ? action(latest.current) : action;
      latest.current = next;
      setState(next);
      try {
        if (next.draft === emptyBookingDraft && next.outcome === null) {
          window.sessionStorage.removeItem(key);
        } else {
          window.sessionStorage.setItem(key, JSON.stringify(next));
        }
      } catch {
        // The same route layout keeps the draft in memory when storage is unavailable.
      }
    },
    [key],
  );

  return (
    <BookingContext.Provider value={{ login, state, update, idempotency }}>
      {children}
    </BookingContext.Provider>
  );
}

export function BookingSessionProvider({ children }: { children: ReactNode }): ReactElement {
  const { login } = useParams<{ login: string }>();
  const scope = login.toLowerCase();

  return (
    <BookingSession key={scope} login={scope}>
      {children}
    </BookingSession>
  );
}

export function useBookingSession(): BookingSessionValue {
  const session = useContext(BookingContext);
  if (!session) throw new Error("The booking session provider is required.");
  return session;
}
