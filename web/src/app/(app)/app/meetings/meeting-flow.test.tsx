import { webcrypto } from "node:crypto";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { AppNavigationProvider } from "@/components/shell/navigation";
import { AccountProvider } from "@/lib/account";
import type { Schemas } from "@/lib/api/client";
import { t } from "@/lib/i18n/messages";
import { loadDraft, saveDraft } from "@/lib/meeting-draft";
import { setSessionToken } from "@/lib/session";
import LimitPage from "../limit/page";
import ClientArchivePage from "../people/clients/[id]/archive/page";
import ClientCardPage from "../people/clients/[id]/page";
import ClientMeetingsPage from "../people/clients/[id]/meetings/page";
import EditMeetingPage from "./[id]/edit/page";
import OutcomePage from "./[id]/outcome/page";
import MeetingPage from "./[id]/page";
import NewMeetingPage from "./new/page";

const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), search: "", id: "meeting-one" }));
vi.mock("next/navigation", () => ({
  useRouter: () => nav,
  useParams: () => ({ id: nav.id }),
  usePathname: () => window.location.pathname,
  useSearchParams: () => new URLSearchParams(nav.search),
}));

type Account = Schemas["Account"];
type Card = Schemas["ClientCard"];
type Detail = Schemas["MeetingDetail"];
type MeetingCreate = Schemas["MeetingCreate"];
type Currency = Schemas["Currency"];

const api = "https://api.example.test";
const meetingHref = "/app/meetings/meeting-one";
const newHref = "/app/meetings/new";
const cardHref = "/app/people/clients/card-one";
const date = "2035-11-25";
const future = date + "T13:00:00.000Z";
const past = "2026-02-10T13:00:00.000Z";
const defaultLink = "https://meet.example.test/start";
const accountAddress = "https://celmento.com/adalovelace";

function owner(clients = 1, activated = true): Account {
  return {
    id: "owner",
    contour: "world",
    email: "owner@example.test",
    first_name: "Ada",
    last_name: "Lovelace",
    photo_url: null,
    phone: null,
    telegram: null,
    whatsapp: null,
    login: "adalovelace",
    address_url: accountAddress,
    language: "en",
    time_zone: "Europe/Belgrade",
    activated,
    activated_at: activated ? past : null,
    leader: activated
      ? {
          specializations: [],
          specialization_other: null,
          about: "",
          contact_email: null,
          links: [],
          main_channel: null,
          booking_url: accountAddress,
          working_hours: [],
          session_duration_minutes: 45,
          session_format: "online",
          default_meeting_link: defaultLink,
          default_rate: "75",
          default_currency: "USD",
          plan: {
            kind: "free",
            active_clients: clients,
            client_limit: 3,
            subscription_until: null,
          },
        }
      : null,
    acceptances: [],
    created_at: past,
  };
}

function client(overrides: Partial<Card> = {}): Card {
  return {
    id: "card-one",
    name: "Grace Hopper",
    photo_url: null,
    phone: "+1 555 0100",
    email: null,
    telegram: "@grace",
    whatsapp: null,
    other_contact: null,
    preferred_channel: "telegram",
    rate: "25.50",
    currency: "EUR",
    request: null,
    goals: null,
    info: null,
    hypotheses: null,
    status: "active",
    archived_at: null,
    linked: true,
    is_new: false,
    source: "created",
    completed_sessions: 2,
    completed_hours: 1.5,
    balance: {
      balance: { amount: "0", currency: "EUR" },
      sessions_left: null,
      unpaid_sessions: null,
    },
    created_at: past,
    self_given_email: "booking@example.test",
    link: { status: "linked", method: "login", login: "grace_h" },
    payment_type: "paid",
    ...overrides,
  };
}

function ref(card: Card): NonNullable<Detail["client"]> {
  return {
    id: card.id,
    name: card.name,
    photo_url: card.photo_url,
    linked: card.linked,
    archived: card.status === "archived",
    time_zone: "Asia/Tokyo",
  };
}

function meeting(overrides: Partial<Detail> = {}): Detail {
  const card = client();
  return {
    id: "meeting-one",
    type: "client_session",
    client: ref(card),
    with_whom: null,
    topic: null,
    starts_at: past,
    duration_minutes: 45,
    my_duration_minutes: null,
    actual_duration_minutes: null,
    place: "online",
    meeting_link: defaultLink,
    address: null,
    price: { amount: "1900", currency: "RUB" },
    status: "scheduled",
    charged: null,
    comment: "Owner's private detail",
    source: "specialist",
    client_comment: null,
    awaiting_outcome: true,
    created_at: past,
    payment_type: "paid",
    invite_url: null,
    client_card: card,
    balance_charge: null,
    ...overrides,
  };
}

function row(card: Card, last: string | null): Schemas["ClientListItem"] {
  return {
    id: card.id,
    name: card.name,
    photo_url: card.photo_url,
    linked: card.linked,
    is_new: false,
    status: card.status,
    archived_at: card.archived_at,
    completed_sessions: 0,
    balance: card.balance,
    last_meeting_at: last,
  };
}

function defaults(currency: Currency = "USD"): Schemas["MeetingDefaults"] {
  return { starts_at: future, duration_minutes: 45, meeting_link: defaultLink, currency };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

type Handler = (
  request: Request,
  path: string,
  url: URL,
) => Response | undefined | Promise<Response | undefined>;

function setup(
  handle?: Handler,
  options: {
    account?: Account;
    meeting?: Detail;
    cards?: Card[];
    rows?: Schemas["ClientListItem"][];
  } = {},
): Request[] {
  const requests: Request[] = [];
  const cards = options.cards ?? [client()];
  const account = options.account ?? owner();
  const current = options.meeting ?? meeting();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (request: Request): Promise<Response> => {
      const url = new URL(request.url);
      if (url.origin !== api) throw new Error("Unexpected request host.");
      const path = url.pathname.replace(/^\/api\/v1/u, "");
      requests.push(request.clone());
      const override = await handle?.(request, path, url);
      if (override) return override;
      if (path === "/account") return json(account);
      if (path === "/notices") return json({ items: [] });
      if (path === "/meetings/defaults") return json(defaults());
      if (path === "/meetings/meeting-one") return json(current);
      if (path === "/clients") {
        return json({
          items: options.rows ?? cards.map((item) => row(item, null)),
          plan: account.leader?.plan,
        });
      }
      if (path.endsWith("/meetings") && path.startsWith("/clients/"))
        return json({ upcoming: [], past: [] });
      if (path.endsWith("/notes") && path.startsWith("/clients/")) return json({ items: [] });
      const card = cards.find(({ id }) => path === "/clients/" + id);
      if (card) return json(card);
      throw new Error("Unexpected request: " + request.method + " " + path);
    }),
  );
  return requests;
}

function calls(requests: Request[], method: string, path: string): Request[] {
  return requests.filter(
    (request) => request.method === method && new URL(request.url).pathname === "/api/v1" + path,
  );
}

function view(page: ReactElement): ReactElement {
  return (
    <AccountProvider>
      <AppNavigationProvider>{page}</AppNavigationProvider>
    </AccountProvider>
  );
}

function button(key: Parameters<typeof t>[0]): HTMLElement {
  return screen.getByRole("button", { name: t(key) });
}

function change(label: string | RegExp, value: string): void {
  fireEvent.change(screen.getByRole("textbox", { name: label }), { target: { value } });
}

function setLocation(path: string): void {
  window.history.replaceState(null, "", path);
  nav.search = window.location.search;
}

beforeAll(() => {
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.open = false;
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_CLM_APP_API_URL", api);
  vi.stubEnv("NEXT_PUBLIC_CLM_APP_CONTOUR", "world");
  vi.stubGlobal("crypto", webcrypto);
  nav.id = "meeting-one";
  setLocation(newHref);
  setSessionToken("meeting-test-session");
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

// spec:test meeting-form#show-selected-client-currency-next
// spec:test meeting-form#show-client-session-payment-type
// spec:test meeting-form#make-paid-unavailable-price-client
// spec:test meeting-form#default-duration-profile-session
// spec:test meeting-form#accept-manually-entered-duration-longer
// spec:test meeting-form#preselect-place-online-show-link
// spec:test meeting-form#keep-comment-optional-visible-leader
// spec:test meeting-form#enable-save-only-required-field
test("uses local time, client pricing, manual duration and a stable idempotency key on creation", async () => {
  setLocation(newHref + "?client_id=card-one&date=" + date);
  const posted = new Map<string, Detail>();
  const requests = setup((request, path) => {
    if (path === "/meetings" && request.method === "POST") {
      const key = request.headers.get("Idempotency-Key");
      if (!key) throw new Error("Creates need an idempotency key.");
      const stored = posted.get(key);
      if (stored) return json(stored, 201);
      posted.set(key, meeting({ starts_at: future }));
      throw new TypeError("Response lost after commit.");
    }
  });
  render(view(<NewMeetingPage />));
  await screen.findByRole("heading", { name: t("meetings.empty_day_cta") });

  const price = await screen.findByRole("textbox", { name: "Price · EUR" });
  expect(price).toHaveProperty("value", "25.50");
  expect(button("form.type_session").getAttribute("aria-pressed")).toBe("true");
  for (const key of [
    "form.type_therapy",
    "form.type_supervision",
    "form.type_mutual",
    "form.type_training",
  ] as const) {
    expect(button(key)).toBeTruthy();
  }
  expect(screen.queryByRole("group", { name: t("form.currency") })).toBeNull();
  expect(screen.queryByRole("group", { name: t("form.outcome_block") })).toBeNull();
  expect(screen.getByLabelText(t("form.date"))).toHaveProperty("value", date);
  expect(screen.getByLabelText(t("form.start"))).toHaveProperty("value", "14:00");
  expect(screen.getByRole("textbox", { name: t("form.duration") })).toHaveProperty("value", "45");
  const durationGroup = within(screen.getByRole("group", { name: t("form.duration") }));
  for (const minutes of [15, 30, 45, 60, 75, 90]) {
    expect(
      durationGroup.getByRole("button", { name: t("public.duration", { N: minutes }) }),
    ).toBeTruthy();
  }
  expect(screen.getByText(t("form.ends_at", { time: "14:45" }))).toBeTruthy();
  expect(screen.getByRole("textbox", { name: t("form.link") })).toHaveProperty(
    "value",
    defaultLink,
  );
  expect(button("form.paid").getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(button("form.place_offline"));
  expect(screen.queryByRole("textbox", { name: t("form.link") })).toBeNull();
  expect(screen.getByRole("textbox", { name: t("form.address") })).toHaveProperty("value", "");
  change(t("form.address"), "Study A");
  change(t("form.duration"), "495");
  expect(screen.getByText(t("form.ends_at", { time: "22:15" }))).toBeTruthy();
  change(/Price/u, "0");
  expect(button("form.paid")).toHaveProperty("disabled", true);
  expect(button("form.save")).toHaveProperty("disabled", true);
  fireEvent.click(button("form.barter"));
  change(t("form.comment"), "Private note");
  fireEvent.click(button("form.save"));
  expect(await screen.findByText(t("extra.auth_network_error"))).toBeTruthy();
  fireEvent.click(button("form.save"));
  await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/app/meetings?date=" + date));

  const creates = calls(requests, "POST", "/meetings");
  expect(creates).toHaveLength(2);
  expect(creates[0]?.headers.get("Idempotency-Key")).toBe(
    creates[1]?.headers.get("Idempotency-Key"),
  );
  expect(posted.size).toBe(1);
  expect(await creates[0]?.json()).toEqual({
    type: "client_session",
    starts_at: future,
    duration_minutes: 495,
    place: "in_person",
    comment: "Private note",
    allow_overlap: false,
    address: "Study A",
    client_id: "card-one",
    price: "0",
    payment_type: "barter",
  });
});

async function picker(clientName: string): Promise<ReturnType<typeof within>> {
  fireEvent.click(
    screen.getByRole("button", {
      name: new RegExp("^" + t("form.client") + ".*" + clientName, "u"),
    }),
  );
  return within(await screen.findByRole("dialog", { name: t("form.client") }));
}

// spec:test meeting-form#list-client-picker-only-active
// spec:test meeting-form#open-form-filled-meeting-current
// spec:test meeting-reschedule-cancel-delete#open-meeting-form-meeting-fields
test("opens the saved values and preserves historical pricing when reselecting a client", async () => {
  setLocation(meetingHref + "/edit?reschedule=1");
  const original = client();
  const newer = client({
    id: "other",
    name: "Alan Turing",
    rate: "75",
    currency: "USD",
    linked: false,
  });
  const noMeetings = client({ id: "no-meetings", name: "Alice", linked: false });
  const archived = client({ id: "archived", name: "Hidden", status: "archived" });
  const requests = setup(undefined, {
    cards: [original, newer, noMeetings, archived],
    rows: [row(noMeetings, null), row(original, past), row(archived, future), row(newer, future)],
  });
  render(view(<EditMeetingPage />));
  await screen.findByRole("heading", { name: t("card.reschedule") });
  expect(screen.getByLabelText(t("form.date"))).toHaveProperty("value", "2026-02-10");
  expect(document.activeElement).toBe(screen.getByLabelText(t("form.date")));
  expect(screen.getByLabelText(t("form.start"))).toHaveProperty("value", "14:00");
  expect(screen.getByRole("textbox", { name: t("form.duration") })).toHaveProperty("value", "45");
  expect(screen.getByRole("textbox", { name: t("form.link") })).toHaveProperty(
    "value",
    defaultLink,
  );
  expect(screen.getByRole("textbox", { name: t("form.comment") })).toHaveProperty(
    "value",
    "Owner's private detail",
  );
  expect(screen.getByRole("textbox", { name: "Price · RUB" })).toHaveProperty("value", "1900");
  change("Price · RUB", "1999.99");

  const firstPicker = await picker(original.name);
  const list = within(firstPicker.getByRole("list"));
  await list.findByRole("button", { name: newer.name });
  expect(list.getAllByRole("button")).toEqual(
    [newer, original, noMeetings].map(({ name }) => list.getByRole("button", { name })),
  );
  expect(list.queryByRole("button", { name: archived.name })).toBeNull();
  expect(new URL(calls(requests, "GET", "/clients")[0]!.url).searchParams.get("status")).toBe(
    "active",
  );
  fireEvent.change(firstPicker.getByRole("searchbox"), { target: { value: "hopper" } });
  expect(list.getAllByRole("button")).toEqual([list.getByRole("button", { name: original.name })]);
  fireEvent.click(list.getByRole("button", { name: original.name }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(screen.getByRole("textbox", { name: "Price · RUB" })).toHaveProperty("value", "1999.99");

  const secondPicker = await picker(original.name);
  fireEvent.click(await secondPicker.findByRole("button", { name: newer.name }));
  expect(await screen.findByRole("textbox", { name: "Price · USD" })).toHaveProperty("value", "75");
  const thirdPicker = await picker(newer.name);
  fireEvent.click(await thirdPicker.findByRole("button", { name: original.name }));
  expect(await screen.findByRole("textbox", { name: "Price · RUB" })).toHaveProperty(
    "value",
    "1900",
  );
  expect(calls(requests, "PATCH", "/meetings/meeting-one")).toHaveLength(0);
});

test("keeps a successful details change and retries only the outcome until details change again", async () => {
  setLocation(meetingHref + "/edit");
  let result = meeting();
  let attempts = 0;
  const requests = setup(async (request, path) => {
    if (path === "/meetings/meeting-one" && request.method === "PATCH") {
      const data = (await request.json()) as Schemas["MeetingUpdate"];
      result = { ...result, starts_at: "2026-02-10T14:00:00+01:00", comment: data.comment ?? null };
      return json(result);
    }
    if (path === "/meetings/meeting-one/outcome" && request.method === "PUT") {
      attempts += 1;
      return attempts === 3
        ? json({ ...result, status: "completed" })
        : json({ code: "temporary_error" }, 500);
    }
  });
  render(view(<EditMeetingPage />));
  await screen.findByRole("heading", { name: t("card.edit") });
  change(t("form.comment"), "First committed edit");
  fireEvent.click(button("outcome.done"));
  change(t("outcome.actual_duration"), "40");
  fireEvent.click(button("form.save"));

  const receipt = t("extra.meeting_details_saved_outcome_pending");
  expect(await screen.findByText(receipt)).toBeTruthy();
  expect(screen.getByRole("textbox", { name: t("form.comment") })).toHaveProperty(
    "value",
    "First committed edit",
  );
  expect(screen.getByRole("textbox", { name: t("outcome.actual_duration") })).toHaveProperty(
    "value",
    "40",
  );
  expect(nav.replace).not.toHaveBeenCalled();
  fireEvent.click(button("form.save"));
  await waitFor(() => expect(attempts).toBe(2));
  await screen.findByText(receipt);
  expect(calls(requests, "PATCH", "/meetings/meeting-one")).toHaveLength(1);

  change(t("form.comment"), "Second intended edit");
  expect(screen.queryByText(receipt)).toBeNull();
  fireEvent.click(button("form.save"));
  await waitFor(() => expect(nav.replace).toHaveBeenCalledWith(meetingHref));
  const changes = requests.filter(({ method }) => method === "PATCH" || method === "PUT");
  expect(changes.map(({ method }) => method)).toEqual(["PATCH", "PUT", "PUT", "PATCH", "PUT"]);
  expect(await changes[3]?.json()).toMatchObject({ comment: "Second intended edit" });
  expect(await changes[4]?.json()).toEqual({
    status: "completed",
    actual_duration_minutes: 40,
    price: "1900",
    payment_type: "paid",
  });
});

// spec:test meeting-form#show-client-session-personal-therapy
// spec:test meeting-form#offer-types-type-session-type-therapy
// spec:test meeting-form#fill-price-selected-client-rate
// spec:test meeting-form#default-currency-personal-therapy
test("requires currency from the current expense lookup and lets the leader choose a different currency", async () => {
  setLocation(newHref + "?starts_at=" + encodeURIComponent(future));
  let finishOld: (response: Response) => void = () => {
    throw new Error("Old lookup never started");
  };
  let attempts = 0;
  const requests = setup((request, path, url) => {
    if (path === "/meetings/defaults") {
      const who = url.searchParams.get("with_whom");
      if (who === "Old therapist")
        return new Promise((resolve) => {
          finishOld = resolve;
        });
      if (who === "New therapist") {
        attempts += 1;
        return attempts === 1 ? json({ code: "temporary_error" }, 500) : json(defaults("EUR"));
      }
    }
    if (path === "/meetings" && request.method === "POST")
      return json(
        meeting({
          starts_at: future,
          type: "personal_therapy",
          client: null,
          client_card: null,
        }),
        201,
      );
  });
  render(view(<NewMeetingPage />));
  await screen.findByRole("button", { name: t("form.type_session") });
  expect(button("form.type_session").getAttribute("aria-pressed")).toBe("true");
  expect(screen.getByRole("button", { name: /^Client.*—/u })).toBeTruthy();
  for (const key of ["form.type_supervision", "form.type_training", "form.type_therapy"] as const) {
    fireEvent.click(button(key));
    expect(screen.queryByRole("button", { name: /^Client.*—/u })).toBeNull();
    expect(screen.getByRole("textbox", { name: t("form.with_whom") })).toHaveProperty("value", "");
    expect(screen.getByRole("textbox", { name: t("form.topic") })).toHaveProperty("value", "");
    expect(screen.getByLabelText(t("form.date"))).toHaveProperty("value", date);
    expect(screen.getByLabelText(t("form.start"))).toHaveProperty("value", "14:00");
    expect(screen.getByRole("textbox", { name: t("form.duration") })).toHaveProperty("value", "45");
    expect(button("form.place_online")).toBeTruthy();
    expect(button("form.place_offline")).toBeTruthy();
    expect(screen.getByRole("textbox", { name: t("form.price") })).toHaveProperty("value", "0");
    expect(screen.getByRole("textbox", { name: t("form.comment") })).toHaveProperty("value", "");
    expect(screen.queryByRole("button", { name: t("form.paid") })).toBeNull();
  }
  const currency = within(screen.getByRole("group", { name: t("form.currency") }));
  await waitFor(() =>
    expect(currency.getByRole("button", { name: /USD/u }).getAttribute("aria-pressed")).toBe(
      "true",
    ),
  );
  change(t("form.with_whom"), "Old therapist");
  await waitFor(() =>
    expect(
      calls(requests, "GET", "/meetings/defaults").some(
        ({ url }) => new URL(url).searchParams.get("with_whom") === "Old therapist",
      ),
    ).toBe(true),
  );
  change(t("form.with_whom"), "New therapist");
  expect(await screen.findByText(t("extra.auth_request_failed"))).toBeTruthy();
  expect(button("form.save")).toHaveProperty("disabled", true);
  fireEvent.click(button("extra.auth_retry"));
  await waitFor(() =>
    expect(currency.getByRole("button", { name: /EUR/u }).getAttribute("aria-pressed")).toBe(
      "true",
    ),
  );
  await act(async () => finishOld(json(defaults("RUB"))));
  expect(currency.getByRole("button", { name: /EUR/u }).getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(currency.getByRole("button", { name: /RUB/u }));
  change(t("form.price"), "125.50");
  fireEvent.click(button("form.save"));
  await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/app/meetings?date=" + date));
  expect(await calls(requests, "POST", "/meetings")[0]?.json()).toMatchObject({
    type: "personal_therapy",
    with_whom: "New therapist",
    price: "125.50",
    currency: "RUB",
  });
});

// spec:test meeting-form#refuse-save-new-changed-meeting
test.each(["new", "edit"] as const)(
  "preserves entered %s session details without sending a request when offline",
  async (mode) => {
    setLocation(
      mode === "new" ? newHref + "?client_id=card-one&date=" + date : meetingHref + "/edit",
    );
    const requests = setup();
    render(view(mode === "new" ? <NewMeetingPage /> : <EditMeetingPage />));
    await screen.findByRole("textbox", { name: t("form.comment") });
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    change(t("form.comment"), "Keep this offline edit");
    fireEvent.click(button("form.save"));
    expect((await screen.findByRole("alert")).textContent).toBe(t("extra.auth_network_error"));
    expect(screen.getByRole("textbox", { name: t("form.comment") })).toHaveProperty(
      "value",
      "Keep this offline edit",
    );
    expect(calls(requests, "POST", "/meetings")).toHaveLength(0);
    expect(calls(requests, "PATCH", "/meetings/meeting-one")).toHaveLength(0);
  },
);

// spec:test meeting-form#show-outcome-block-done-missed-only-entered
// spec:test meeting-form#show-overlap-time-name-existing
test("shows outcome choices only for backdated sessions and asks before saving an overlap", async () => {
  setLocation(newHref + "?client_id=card-one&starts_at=" + encodeURIComponent(future));
  const requests = setup(async (request, path) => {
    if (path !== "/meetings" || request.method !== "POST") return;
    const body = (await request.json()) as MeetingCreate;
    return body.allow_overlap
      ? json(meeting({ status: "completed" }), 201)
      : json({ code: "meeting_overlap", details: { meeting: meeting() } }, 409);
  });
  render(view(<NewMeetingPage />));
  await screen.findByRole("textbox", { name: "Price · EUR" });
  expect(screen.queryByRole("group", { name: t("form.outcome_block") })).toBeNull();
  fireEvent.change(screen.getByLabelText(t("form.date")), { target: { value: "2026-02-10" } });
  const outcomes = within(screen.getByRole("group", { name: t("form.outcome_block") }));
  expect(outcomes.getByRole("button", { name: t("outcome.missed") })).toBeTruthy();
  fireEvent.click(outcomes.getByRole("button", { name: t("outcome.done") }));
  change(t("outcome.actual_duration"), "30");
  const overlapTitle = t("form.overlap", { time: "14:00", name: "Grace Hopper" });
  fireEvent.click(button("form.save"));
  fireEvent.click(
    within(await screen.findByRole("dialog", { name: overlapTitle })).getByRole("button", {
      name: t("form.overlap_change"),
    }),
  );
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(screen.getByLabelText(t("form.start")));
  expect(screen.getByRole("textbox", { name: t("outcome.actual_duration") })).toHaveProperty(
    "value",
    "30",
  );
  fireEvent.click(button("form.save"));
  fireEvent.click(
    within(await screen.findByRole("dialog", { name: overlapTitle })).getByRole("button", {
      name: t("form.overlap_save"),
    }),
  );
  await waitFor(() => expect(nav.replace).toHaveBeenCalledWith(meetingHref));
  const creates = calls(requests, "POST", "/meetings");
  const bodies = await Promise.all(
    creates.map((request) => request.json() as Promise<MeetingCreate>),
  );
  expect(bodies.map(({ allow_overlap }) => allow_overlap)).toEqual([false, false, true]);
  expect(bodies[2]).toMatchObject({
    starts_at: past,
    outcome: {
      status: "completed",
      actual_duration_minutes: 30,
      price: "25.50",
      payment_type: "paid",
    },
  });
});

// spec:test meeting-form#switch-form-mutual-practice-fields
// spec:test mutual-practice-meeting#offer-type-type-mutual-meeting-form
// spec:test mutual-practice-meeting#show-mutual-practice-fields-with-whom
test.each([0, 1])(
  "offers mutual practice with %i active clients and validates the specialist's minutes",
  async (clients) => {
    setLocation(newHref + "?starts_at=" + encodeURIComponent(future));
    const requests = setup(
      (request, path) => {
        if (path === "/meetings" && request.method === "POST")
          return json(
            meeting({
              type: "mutual_practice",
              starts_at: future,
              client: null,
              client_card: null,
              price: null,
              payment_type: null,
            }),
            201,
          );
      },
      { account: owner(clients) },
    );
    render(view(<NewMeetingPage />));
    fireEvent.click(await screen.findByRole("button", { name: t("form.type_mutual") }));
    expect(button("form.type_mutual").getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByRole("button", { name: /^Client.*—/u })).toBeNull();
    expect(screen.queryByRole("textbox", { name: t("form.price") })).toBeNull();
    expect(screen.queryByRole("group", { name: t("form.currency") })).toBeNull();
    expect(screen.queryByRole("button", { name: t("form.paid") })).toBeNull();
    expect(screen.getByLabelText(t("form.date"))).toHaveProperty("value", date);
    expect(screen.getByLabelText(t("form.start"))).toHaveProperty("value", "14:00");
    expect(screen.getByRole("textbox", { name: t("form.duration") })).toHaveProperty("value", "45");
    expect(screen.getByRole("textbox", { name: t("form.my_duration") })).toHaveProperty(
      "value",
      "",
    );
    expect(screen.getByRole("textbox", { name: t("form.link") })).toHaveProperty(
      "value",
      defaultLink,
    );
    expect(screen.getByRole("textbox", { name: t("form.with_whom") })).toHaveProperty("value", "");
    expect(screen.getByRole("textbox", { name: t("form.topic") })).toHaveProperty("value", "");
    expect(screen.getByRole("textbox", { name: t("form.comment") })).toHaveProperty("value", "");
    expect(button("form.save")).toHaveProperty("disabled", true);
    fireEvent.click(button("form.place_offline"));
    expect(screen.getByRole("textbox", { name: t("form.address") })).toHaveProperty("value", "");
    change(t("form.my_duration"), "46");
    expect(button("form.save")).toHaveProperty("disabled", true);
    change(t("form.my_duration"), "30");
    fireEvent.click(button("form.save"));
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/app/meetings?date=" + date));
    expect(await calls(requests, "POST", "/meetings")[0]?.json()).toEqual({
      type: "mutual_practice",
      starts_at: future,
      duration_minutes: 45,
      my_duration_minutes: 30,
      place: "in_person",
      address: null,
      with_whom: null,
      topic: null,
      comment: null,
      allow_overlap: false,
    });
  },
);

// spec:test client-card-create#open-short-form-new-client-client
// spec:test client-card-create#create-card-short-form-saved
// spec:test meeting-form#open-short-client-form-new-client
test("opens the short client form and picks the newly saved client for the current meeting", async () => {
  setLocation(newHref + "?starts_at=" + encodeURIComponent(future));
  const requests = setup((request, path) => {
    if (path === "/clients" && request.method === "POST")
      return json(client({ id: "new-client", name: "New person" }), 201);
  });
  render(view(<NewMeetingPage />));
  await screen.findByRole("button", { name: t("form.type_session") });
  change(t("form.comment"), "Keep typed meeting details");
  const select = await picker("—");
  fireEvent.click(select.getByRole("button", { name: t("form.new_client") }));
  const dialog = within(await screen.findByRole("dialog", { name: t("new.title") }));
  expect(dialog.queryByRole("textbox", { name: t("new.rate") })).toBeNull();
  expect(dialog.getByRole("button", { name: t("extra.client_save") })).toHaveProperty(
    "disabled",
    true,
  );
  fireEvent.change(dialog.getByRole("textbox", { name: t("new.name") }), {
    target: { value: "New person" },
  });
  fireEvent.click(dialog.getByRole("button", { name: t("extra.client_save") }));
  expect(await screen.findByRole("button", { name: /^Client.*New person/u })).toBeTruthy();
  expect(screen.getByRole("textbox", { name: t("form.comment") })).toHaveProperty(
    "value",
    "Keep typed meeting details",
  );
  expect(await calls(requests, "POST", "/clients")[0]?.json()).toEqual({
    name: "New person",
    phone: null,
    email: null,
    telegram: null,
    whatsapp: null,
  });
});

// spec:test client-card-create#run-limit-check-new-client-tapped
// spec:test meeting-form#open-short-client-form-new-client
// spec:test free-plan-client-limit#return-meeting-form-entered-value
// spec:test free-plan-client-limit#make-creating-restoring-new-client
test("keeps meeting details on the free-plan limit screen and restores them on return", async () => {
  setLocation(newHref + "?date=" + date);
  let active = 3;
  const requests = setup((request, path) => {
    if (path === "/account") return json(owner(active));
    if (request.method === "POST" && path === "/plans/limit-hits")
      return json(owner(active).leader?.plan);
  });
  const rendered = render(view(<NewMeetingPage />));
  await screen.findByRole("button", { name: t("form.type_session") });
  change(t("form.comment"), "A draft survives");
  change(t("form.link"), "https://meet.example.test/draft");
  const select = await picker("—");
  fireEvent.click(select.getByRole("button", { name: t("form.new_client") }));
  const limit = new URL(nav.push.mock.calls[0]?.[0], api);
  expect(limit.pathname).toBe("/app/limit");
  expect(limit.searchParams.get("reason")).toBe("new_client");
  const returnTo = newHref + "?date=" + date + "&resume=1";
  expect(limit.searchParams.get("returnTo")).toBe(returnTo);
  expect(calls(requests, "POST", "/clients")).toHaveLength(0);
  const draft = loadDraft("owner", newHref);
  expect(draft).toMatchObject({
    comment: "A draft survives",
    link: "https://meet.example.test/draft",
  });
  expect(loadDraft("different-owner", newHref)).toBeNull();
  expect(loadDraft("owner", newHref + "/other")).toBeNull();

  setLocation(limit.pathname + limit.search);
  rendered.rerender(view(<LimitPage />));
  await screen.findByRole("heading", { name: t("limit.new_client") });
  expect(screen.getByRole("link", { name: t("extra.back") }).getAttribute("href")).toBe(returnTo);
  expect(calls(requests, "POST", "/plans/limit-hits")).toHaveLength(1);
  expect(calls(requests, "GET", "/plans")).toHaveLength(0);

  active = 2;
  act(() => window.dispatchEvent(new Event("focus")));
  await waitFor(() => expect(nav.replace).toHaveBeenCalledWith(returnTo));
  expect(calls(requests, "POST", "/plans/limit-hits")).toHaveLength(1);
  setLocation(returnTo);
  rendered.rerender(view(<NewMeetingPage />));
  expect(await screen.findByRole("textbox", { name: t("form.comment") })).toHaveProperty(
    "value",
    "A draft survives",
  );
  expect(screen.getByRole("textbox", { name: t("form.link") })).toHaveProperty(
    "value",
    "https://meet.example.test/draft",
  );
});

test("falls back to session defaults when a malformed old draft is loaded", async () => {
  setLocation(newHref + "?date=" + date + "&resume=1");
  const stale = { type: "personal_therapy", date, start: "14:00" };
  saveDraft("owner", newHref, stale as Parameters<typeof saveDraft>[2]);
  setup();
  render(view(<NewMeetingPage />));
  expect(await screen.findByRole("textbox", { name: t("form.comment") })).toHaveProperty(
    "value",
    "",
  );
  expect(screen.getByLabelText(t("form.date"))).toHaveProperty("value", date);
  expect(loadDraft("owner", newHref)).toBeNull();
});

// spec:test client-archive-restore#list-screen-5-4-planned-client
// spec:test client-archive-restore#show-balance-client-currency-screen
// spec:test client-archive-restore#show-keep-history-buttons-confirm-cancel
// spec:test client-archive-restore#show-top-screen-5-4-outcomes-first
// spec:test client-archive-restore#keep-confirm-disabled-outcomes-first
// spec:test client-archive-restore#run-usual-outcome-flow-buttons
test("records both kinds of missing outcome and returns to refresh the archive confirmation", async () => {
  const archiveHref = cardHref + "/archive";
  const pending = [meeting(), meeting({ id: "meeting-two", starts_at: "2026-02-11T14:30:00Z" })];
  const scheduled = meeting({ id: "meeting-future", starts_at: future, awaiting_outcome: false });
  const outcomes = new Map<string, Schemas["MeetingOutcomeInput"]>();
  const requests = setup(async (request, path) => {
    if (path === "/clients/card-one/archive-preview") {
      return json({
        preview_token: "archive-preview",
        meetings_awaiting_outcome: pending.filter(({ id }) => !outcomes.has(id)),
        meetings_to_delete: [scheduled],
        balance: { amount: "-745.20", currency: "EUR" },
      } satisfies Schemas["ClientArchivePreview"]);
    }
    const session = pending.find(
      ({ id }) => path === `/meetings/${id}` || path === `/meetings/${id}/outcome`,
    );
    if (session && request.method === "GET") return json(session);
    if (session && request.method === "PUT") {
      const outcome: Schemas["MeetingOutcomeInput"] = await request.json();
      outcomes.set(session.id, outcome);
      return json({
        ...session,
        status: outcome.status,
        actual_duration_minutes: outcome.actual_duration_minutes ?? null,
        charged: outcome.charged ?? null,
        awaiting_outcome: false,
      } satisfies Detail);
    }
  });

  nav.id = "card-one";
  setLocation(archiveHref);
  const viewResult = render(view(<ClientArchivePage />));
  const blockTitle = t("archive.outcomes_first");
  await screen.findByRole("heading", { name: blockTitle });
  const panel = screen.getByRole("heading", { name: blockTitle }).parentElement?.parentElement;
  expect(panel?.firstElementChild?.textContent).toContain(blockTitle);
  expect(screen.getByRole("heading", { name: t("archive.planned") })).toBeTruthy();
  expect(screen.getByText("25 November · 14:00")).toBeTruthy();
  expect(screen.getByText(t("archive.balance", { amount: "−745.20 €" }))).toBeTruthy();
  expect(screen.getByText(t("archive.keep_history"))).toBeTruthy();
  expect(button("archive.confirm")).toHaveProperty("disabled", true);
  expect(button("archive.cancel")).toHaveProperty("disabled", false);

  const first = screen.getByText("10 February · 14:00").closest("li");
  if (!first) throw new Error("Expected the first pending session.");
  fireEvent.click(within(first).getByRole("button", { name: t("outcome.done") }));
  const doneHref = meetingHref + "/outcome?from=archive&status=completed";
  expect(nav.push).toHaveBeenLastCalledWith(doneHref);
  nav.id = "meeting-one";
  setLocation(doneHref + "&returnTo=/app/profile&client_id=unrelated-card");
  viewResult.rerender(view(<OutcomePage />));
  const actual = await screen.findByRole("textbox", { name: t("outcome.actual_duration") });
  expect(actual).toHaveProperty("value", "45");
  fireEvent.click(button("form.save"));
  await screen.findByRole("heading", { name: t("outcome.saved_hours") });
  fireEvent.click(button("extra.close"));
  expect(nav.push).toHaveBeenLastCalledWith(archiveHref);
  expect(outcomes.get("meeting-one")).toEqual({
    status: "completed",
    actual_duration_minutes: 45,
    price: "1900",
    payment_type: "paid",
  });

  nav.id = "card-one";
  setLocation(archiveHref);
  viewResult.rerender(view(<ClientArchivePage />));
  const second = (await screen.findByText("11 February · 15:30")).closest("li");
  if (!second) throw new Error("Expected the second pending session.");
  expect(screen.queryByText("10 February · 14:00")).toBeNull();
  expect(button("archive.confirm")).toHaveProperty("disabled", true);
  fireEvent.click(within(second).getByRole("button", { name: t("outcome.missed") }));
  const missedHref = "/app/meetings/meeting-two/outcome?from=archive&status=not_taken_place";
  expect(nav.push).toHaveBeenLastCalledWith(missedHref);
  nav.id = "meeting-two";
  setLocation(missedHref);
  viewResult.rerender(view(<OutcomePage />));
  await screen.findByRole("group", { name: t("outcome.charge_q") });
  expect(button("form.save")).toHaveProperty("disabled", true);
  fireEvent.click(button("outcome.no"));
  fireEvent.click(button("form.save"));
  await screen.findByText(t("card.hours_not_counted"));
  fireEvent.click(button("extra.close"));
  expect(nav.push).toHaveBeenLastCalledWith(archiveHref);
  expect(outcomes.get("meeting-two")).toEqual({ status: "not_taken_place", charged: false });

  nav.id = "card-one";
  setLocation(archiveHref);
  viewResult.rerender(view(<ClientArchivePage />));
  await screen.findByRole("heading", { name: t("archive.planned") });
  expect(screen.queryByRole("heading", { name: blockTitle })).toBeNull();
  expect(button("archive.confirm")).toHaveProperty("disabled", false);
  fireEvent.click(button("archive.cancel"));
  expect(nav.push).toHaveBeenLastCalledWith(cardHref);
  expect(outcomes.size).toBe(2);
  expect(calls(requests, "POST", "/clients/card-one/archive")).toHaveLength(0);
});

test("refreshes a changed archive preview and requires another confirmation of the new list", async () => {
  nav.id = "card-one";
  setLocation(cardHref + "/archive");
  const scheduled = meeting({ id: "meeting-future", starts_at: future, awaiting_outcome: false });
  const confirmed: Schemas["ClientArchiveConfirm"][] = [];
  const requests = setup(async (request, path) => {
    if (path === "/clients/card-one/archive-preview") {
      return json({
        preview_token: confirmed.length ? "replacement-preview" : "initial-preview",
        meetings_awaiting_outcome: [],
        meetings_to_delete: confirmed.length
          ? [{ ...scheduled, starts_at: date + "T16:30:00Z" }]
          : [scheduled],
        balance: { amount: "0", currency: "USD" },
      } satisfies Schemas["ClientArchivePreview"]);
    }
    if (path === "/clients/card-one/archive" && request.method === "POST") {
      confirmed.push(await request.json());
      return confirmed.length === 1
        ? json({ code: "conflict" }, 409)
        : json(client({ status: "archived", archived_at: past }));
    }
  });
  render(view(<ClientArchivePage />));
  expect(await screen.findByText("25 November · 14:00")).toBeTruthy();
  fireEvent.click(button("archive.confirm"));
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    t("extra.archive_preview_changed"),
  );
  expect(await screen.findByText("25 November · 17:30")).toBeTruthy();
  expect(screen.queryByText("25 November · 14:00")).toBeNull();
  expect(confirmed).toEqual([{ preview_token: "initial-preview" }]);
  expect(nav.replace).not.toHaveBeenCalled();
  fireEvent.click(button("archive.confirm"));
  await waitFor(() => expect(nav.replace).toHaveBeenCalledExactlyOnceWith(cardHref));
  expect(confirmed).toEqual([
    { preview_token: "initial-preview" },
    { preview_token: "replacement-preview" },
  ]);
  expect(calls(requests, "GET", "/account")).toHaveLength(2);
});

test("blocks confirmation when the server finds a newly ended session", async () => {
  nav.id = "card-one";
  setLocation(cardHref + "/archive");
  let ended = false;
  const session = meeting();
  const requests = setup((request, path) => {
    if (path === "/clients/card-one/archive-preview") {
      return json({
        preview_token: ended ? "ended-preview" : "scheduled-preview",
        meetings_awaiting_outcome: ended ? [session] : [],
        meetings_to_delete: ended ? [] : [session],
        balance: { amount: "0", currency: "USD" },
      } satisfies Schemas["ClientArchivePreview"]);
    }
    if (path === "/clients/card-one/archive" && request.method === "POST") {
      ended = true;
      return json({ code: "outcomes_pending" }, 409);
    }
  });
  render(view(<ClientArchivePage />));
  await screen.findByRole("heading", { name: t("archive.planned") });
  fireEvent.click(button("archive.confirm"));
  expect(await screen.findByRole("heading", { name: t("archive.outcomes_first") })).toBeTruthy();
  fireEvent.click(button("archive.confirm"));
  expect(button("archive.confirm")).toHaveProperty("disabled", true);
  expect(calls(requests, "POST", "/clients/card-one/archive")).toHaveLength(1);
});

function openSessionActions(): ReturnType<typeof within> {
  fireEvent.click(button("extra.meeting_actions"));
  return within(screen.getByRole("dialog", { name: t("extra.meeting_actions") }));
}

// spec:test meeting-card#render-meeting-client-archived-client
test("opens the archived client from a grey historical meeting and saves only non-financial edits", async () => {
  const archived = client({ status: "archived", archived_at: past });
  const original = meeting({
    status: "completed",
    client: ref(archived),
    client_card: archived,
    actual_duration_minutes: 38,
    awaiting_outcome: false,
    invite_url: "https://celmento.com/invite-for-test",
  });
  const requests = setup(
    (request, path) => {
      if (path === "/meetings/meeting-one" && request.method === "PATCH")
        return json({ ...original, comment: "A corrected historical comment" });
    },
    { meeting: original, cards: [archived] },
  );
  setLocation(meetingHref);
  const viewResult = render(view(<MeetingPage />));
  const detail = await screen.findByRole("article");
  expect(detail.getAttribute("data-archived")).toBe("true");
  const withinDetail = within(detail);
  expect(withinDetail.queryByRole("link", { name: t("card.call") })).toBeNull();
  for (const key of ["card.change_outcome", "card.share_link", "card.write_note"] as const) {
    expect(withinDetail.queryByRole("button", { name: t(key) })).toBeNull();
  }
  fireEvent.click(withinDetail.getByRole("button", { name: archived.name }));
  expect(nav.push).toHaveBeenLastCalledWith(cardHref);
  nav.id = "card-one";
  setLocation(cardHref);
  viewResult.rerender(view(<ClientCardPage />));
  expect(
    await screen.findByText(t("client.archived_banner", { date: "10 February" })),
  ).toBeTruthy();
  expect(screen.queryByRole("button", { name: t("client.add_payment") })).toBeNull();

  nav.id = "meeting-one";
  setLocation(meetingHref);
  viewResult.rerender(view(<MeetingPage />));
  await screen.findByRole("article");
  const actions = openSessionActions();
  expect(actions.queryByRole("button", { name: t("card.reschedule") })).toBeNull();
  expect(actions.queryByRole("button", { name: t("card.delete") })).toBeNull();
  fireEvent.click(actions.getByRole("button", { name: t("card.edit") }));
  const editHref = meetingHref + "/edit";
  expect(nav.push).toHaveBeenLastCalledWith(editHref);

  setLocation(editHref);
  viewResult.rerender(view(<EditMeetingPage />));
  const price = await screen.findByRole("textbox", { name: "Price · RUB" });
  expect(price).toHaveProperty("value", "1900");
  expect(price).toHaveProperty("disabled", true);
  expect(button("form.paid").getAttribute("aria-pressed")).toBe("true");
  for (const key of ["form.paid", "form.barter", "form.pro_bono"] as const) {
    expect(button(key)).toHaveProperty("disabled", true);
  }
  const dateField = screen.getByLabelText(t("form.date"));
  fireEvent.change(dateField, { target: { value: date } });
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    t("extra.meeting_archived_past"),
  );
  expect(button("form.save")).toHaveProperty("disabled", true);
  fireEvent.change(dateField, { target: { value: "2026-02-10" } });
  change(t("form.comment"), "A corrected historical comment");
  fireEvent.click(button("form.save"));

  await waitFor(() => expect(nav.replace).toHaveBeenCalledExactlyOnceWith(meetingHref));
  const changes = calls(requests, "PATCH", "/meetings/meeting-one");
  expect(changes).toHaveLength(1);
  expect(await changes[0]?.json()).toEqual({
    starts_at: past,
    duration_minutes: 45,
    place: "online",
    meeting_link: defaultLink,
    comment: "A corrected historical comment",
    allow_overlap: false,
  });
  expect(calls(requests, "DELETE", "/meetings/meeting-one")).toHaveLength(0);
});

// spec:test meeting-card#show-filled-field-meeting-f03
// spec:test meeting-card#show-empty-field-meeting-empty
// spec:test meeting-card#open-client-card-leader-taps
// spec:test meeting-card#open-meeting-link-open-meeting-app
// spec:test meeting-card#build-contact-buttons-client-session
// spec:test meeting-card#show-contact-button-contact-empty
// spec:test meeting-card#hand-edit-meeting-form-reschedule
// spec:test time-zone-handling#show-leader-attendee-local-time
test("shows session details, both local times and only the client card's reference contacts", async () => {
  setLocation(meetingHref);
  const reference = client({ email: "reference@example.test", whatsapp: "+1 555 0109" });
  setup(undefined, { meeting: meeting({ client_card: reference }) });
  render(view(<MeetingPage />));
  expect(await screen.findByRole("heading", { name: t("form.type_session") })).toBeTruthy();
  expect(screen.getByText(t("form.date"))).toBeTruthy();
  expect(screen.getByText("14:00")).toBeTruthy();
  expect(
    screen.getByText(t("client.client_time", { time: "22:00" }), { exact: false }),
  ).toBeTruthy();
  expect(screen.getByText(t("public.duration", { N: 45 }))).toBeTruthy();
  expect(screen.getByText(defaultLink)).toBeTruthy();
  expect(screen.getByText("1 900 ₽")).toBeTruthy();
  expect(screen.getByText("Owner's private detail")).toBeTruthy();
  for (const key of [
    "form.address",
    "form.topic",
    "form.with_whom",
    "outcome.actual_duration",
  ] as const) {
    expect(screen.queryByText(t(key))).toBeNull();
  }
  expect(screen.queryByText(t("form.paid"))).toBeNull();
  const actions = within(screen.getByRole("article"));
  expect(actions.getByRole("link", { name: t("card.call") }).getAttribute("href")).toBe(
    "tel:+1%20555%200100",
  );
  expect(actions.getByRole("link", { name: t("card.telegram") }).getAttribute("href")).toBe(
    "https://t.me/grace",
  );
  expect(actions.getByRole("link", { name: t("card.whatsapp") }).getAttribute("href")).toBe(
    "https://wa.me/15550109",
  );
  expect(actions.getByRole("link", { name: t("card.email") }).getAttribute("href")).toBe(
    "mailto:reference@example.test",
  );
  expect(actions.queryByText(reference.self_given_email!)).toBeNull();
  expect(actions.getByRole("link", { name: t("card.open_meeting") }).getAttribute("href")).toBe(
    defaultLink,
  );

  fireEvent.click(actions.getByRole("button", { name: reference.name }));
  expect(nav.push).toHaveBeenLastCalledWith(cardHref);
  fireEvent.click(openSessionActions().getByRole("button", { name: t("card.reschedule") }));
  expect(nav.push).toHaveBeenLastCalledWith(meetingHref + "/edit?reschedule=1");
  fireEvent.click(screen.getByRole("button", { name: t("extra.close") }));
  fireEvent.click(openSessionActions().getByRole("button", { name: t("card.edit") }));
  expect(nav.push).toHaveBeenLastCalledWith(meetingHref + "/edit");
});

// spec:test meeting-card#show-next-price-client-session
// spec:test meeting-card#show-status-label-header-status-planned
// spec:test meeting-card#highlight-one-main-action-large
// spec:test meeting-outcome-recording#show-add-outcome-meeting-card-meeting
test.each([
  {
    start: future,
    status: "scheduled",
    label: "card.status_planned",
    primary: "card.open_meeting",
    payment: "paid",
  },
  {
    start: past,
    status: "scheduled",
    label: "card.status_planned",
    primary: "card.add_outcome",
    payment: "barter",
  },
  {
    start: past,
    status: "completed",
    label: "card.status_done",
    primary: null,
    payment: "pro_bono",
  },
  {
    start: past,
    status: "not_taken_place",
    label: "card.status_missed",
    primary: null,
    payment: "paid",
  },
] as const)(
  "shows the $status status and appropriate main action",
  async ({ start, status, label, primary, payment }) => {
    setLocation(meetingHref);
    setup(undefined, {
      meeting: meeting({
        starts_at: start,
        status,
        payment_type: payment,
        charged: status === "not_taken_place",
      }),
    });
    render(view(<MeetingPage />));
    expect(await screen.findByText(t(label), { exact: false })).toBeTruthy();
    const article = screen.getByRole("article");
    const mainActions = article.querySelectorAll(".shell-primary");
    expect(mainActions).toHaveLength(primary ? 1 : 0);
    if (primary) expect(mainActions[0]?.textContent).toBe(t(primary));
    const add = screen.queryByRole("button", { name: t("card.add_outcome") });
    if (primary === "card.add_outcome") {
      expect(add).toBeTruthy();
      fireEvent.click(add!);
      expect(nav.push).toHaveBeenLastCalledWith(meetingHref + "/outcome");
    } else expect(add).toBeNull();
    const paymentLabel =
      payment === "barter" ? "form.barter" : payment === "pro_bono" ? "form.pro_bono" : "form.paid";
    const details = within(article);
    if (payment === "paid") expect(details.queryByText(t(paymentLabel))).toBeNull();
    else expect(details.getByText(t(paymentLabel))).toBeTruthy();
    if (status === "completed") expect(article.textContent).toContain("✓ " + t("card.status_done"));
    if (status === "not_taken_place") {
      expect(details.getByText(t("card.hours_not_counted"))).toBeTruthy();
      expect(details.getByText(t("card.charged"))).toBeTruthy();
    }
  },
);

// spec:test meeting-card#replace-contact-buttons-no-contacts-link
test("uses the client card link when only the booking email and linked account are known", async () => {
  setLocation(meetingHref);
  setup(undefined, { meeting: meeting({ client_card: client({ phone: null, telegram: null }) }) });
  render(view(<MeetingPage />));
  const noContacts = await screen.findByRole("button", { name: t("card.no_contacts") });
  expect(screen.queryByRole("link", { name: t("card.email") })).toBeNull();
  expect(screen.queryByRole("link", { name: t("card.telegram") })).toBeNull();
  expect(screen.queryByRole("link", { name: t("card.call") })).toBeNull();
  fireEvent.click(noContacts);
  expect(nav.push).toHaveBeenLastCalledWith(cardHref);
});

// spec:test meeting-card#show-contact-buttons-personal-therapy
// spec:test meeting-card#show-price-currency-payment-type
test.each(["personal_therapy", "supervision", "training", "mutual_practice"] as const)(
  "shows only a meeting link for contacts in %s",
  async (type) => {
    setLocation(meetingHref);
    const mutual = type === "mutual_practice";
    setup(undefined, {
      meeting: meeting({
        type,
        starts_at: future,
        client: null,
        client_card: null,
        with_whom: "Alex",
        topic: "Case work",
        my_duration_minutes: mutual ? 15 : null,
        price: mutual ? null : { amount: "100", currency: "USD" },
        payment_type: null,
      }),
    });
    render(view(<MeetingPage />));
    expect(await screen.findByRole("link", { name: t("card.open_meeting") })).toBeTruthy();
    expect(screen.getByText("Alex")).toBeTruthy();
    expect(screen.getByText("Case work")).toBeTruthy();
    for (const key of ["card.call", "card.telegram", "card.whatsapp", "card.email"] as const) {
      expect(screen.queryByRole("link", { name: t(key) })).toBeNull();
    }
    expect(screen.queryByRole("button", { name: t("card.no_contacts") })).toBeNull();
    if (mutual) {
      expect(screen.getByText(t("public.duration", { N: 15 }))).toBeTruthy();
      expect(screen.queryByText(t("form.price"))).toBeNull();
      expect(screen.queryByText(t("form.barter"))).toBeNull();
    }
  },
);

// spec:test meeting-outcome-recording#ask-title-client-name-offer
// spec:test meeting-outcome-recording#open-screen-4-2-after-done
// spec:test meeting-outcome-recording#append-saved-debt-number-unpaid-sessions
test.each(["RUB", "EUR"] as const)(
  "shows historical charge and only matching-currency debt with %s current balance",
  async (currency) => {
    setLocation(meetingHref + "/outcome");
    const updated = meeting({
      status: "completed",
      actual_duration_minutes: 30,
      balance_charge: { amount: "1900", currency: "RUB" },
      client_card: client({
        currency,
        balance: {
          balance: { amount: "-5700", currency },
          sessions_left: null,
          unpaid_sessions: "3",
        },
      }),
    });
    const requests = setup((request, path) => {
      if (path === "/meetings/meeting-one/outcome" && request.method === "PUT")
        return json(updated);
    });
    render(view(<OutcomePage />));
    expect(
      await screen.findByRole("heading", { name: t("outcome.title", { name: "Grace Hopper" }) }),
    ).toBeTruthy();
    expect(button("outcome.missed")).toBeTruthy();
    fireEvent.click(button("outcome.done"));
    const actual = screen.getByRole("textbox", { name: t("outcome.actual_duration") });
    const price = screen.getByRole("textbox", { name: "Price · RUB" });
    expect(actual).toHaveProperty("value", "45");
    expect(price).toHaveProperty("value", "1900");
    expect(button("form.paid").getAttribute("aria-pressed")).toBe("true");
    expect(button("form.barter")).toBeTruthy();
    expect(button("form.pro_bono")).toBeTruthy();
    fireEvent.change(price, { target: { value: "0" } });
    expect(button("form.paid")).toHaveProperty("disabled", true);
    expect(button("form.save")).toHaveProperty("disabled", true);
    fireEvent.change(price, { target: { value: "1900" } });
    fireEvent.click(button("form.paid"));
    const durations = within(screen.getByRole("group", { name: t("outcome.actual_duration") }));
    for (const minutes of [15, 30, 45, 60, 75, 90]) {
      expect(
        durations.getByRole("button", { name: t("public.duration", { N: minutes }) }),
      ).toBeTruthy();
    }
    fireEvent.change(actual, { target: { value: "30" } });
    fireEvent.click(button("form.save"));
    expect(
      await screen.findByRole("heading", { name: t("outcome.saved", { amount: "1 900 ₽" }) }),
    ).toBeTruthy();
    const debt = screen.queryByText(t("outcome.saved_debt", { N: 3 }));
    if (currency === "RUB") expect(debt).toBeTruthy();
    else expect(debt).toBeNull();
    expect(await calls(requests, "PUT", "/meetings/meeting-one/outcome")[0]?.json()).toEqual({
      status: "completed",
      actual_duration_minutes: 30,
      price: "1900",
      payment_type: "paid",
    });
  },
);

// spec:test meeting-outcome-recording#open-screen-4-3-after-missed
test.each(["client_session", "personal_therapy", "supervision", "training"] as const)(
  "asks an unselected charge question before recording a missed %s",
  async (type) => {
    setLocation(meetingHref + "/outcome?status=not_taken_place&from=pending");
    const isClient = type === "client_session";
    const original = isClient
      ? meeting()
      : meeting({ type, client: null, client_card: null, with_whom: "Alex", payment_type: null });
    const requests = setup(
      (request, path) => {
        if (path === "/meetings/meeting-one/outcome" && request.method === "PUT")
          return json({
            ...original,
            status: "not_taken_place",
            charged: false,
          });
      },
      { meeting: original },
    );
    render(view(<OutcomePage />));
    const question = t(isClient ? "outcome.charge_q" : "outcome.expense_q");
    const choices = within(await screen.findByRole("group", { name: question }));
    if (isClient) expect(screen.getByText(t("outcome.charge_hint"))).toBeTruthy();
    const yes = choices.getByRole("button", { name: t("outcome.yes") });
    const no = choices.getByRole("button", { name: t("outcome.no") });
    expect(yes.getAttribute("aria-pressed")).toBe("false");
    expect(no.getAttribute("aria-pressed")).toBe("false");
    expect(button("form.save")).toHaveProperty("disabled", true);
    fireEvent.click(no);
    fireEvent.click(button("form.save"));
    expect(await screen.findByText(t("card.hours_not_counted"))).toBeTruthy();
    expect(await calls(requests, "PUT", "/meetings/meeting-one/outcome")[0]?.json()).toEqual({
      status: "not_taken_place",
      charged: false,
    });
    fireEvent.click(button("extra.close"));
    expect(nav.push).toHaveBeenLastCalledWith("/app/meetings/pending");
  },
);

// spec:test mutual-practice-meeting#ask-title-with-whom-text-type-mutual
// spec:test mutual-practice-meeting#open-after-done-completion-screen
test.each([null, "Alex"])(
  "asks about mutual practice with %s and records actual specialist minutes alone",
  async (withWhom) => {
    setLocation(meetingHref + "/outcome");
    const original = meeting({
      type: "mutual_practice",
      with_whom: withWhom,
      duration_minutes: 105,
      my_duration_minutes: 42,
      client: null,
      client_card: null,
      price: null,
      payment_type: null,
    });
    const requests = setup(
      (request, path) => {
        if (path === "/meetings/meeting-one/outcome" && request.method === "PUT")
          return json({
            ...original,
            status: "completed",
            actual_duration_minutes: 55,
          });
      },
      { meeting: original },
    );
    render(view(<OutcomePage />));
    await screen.findByRole("heading", {
      name: t("outcome.title", { name: withWhom ?? t("form.type_mutual") }),
    });
    expect(button("outcome.missed")).toBeTruthy();
    fireEvent.click(button("outcome.done"));
    expect(screen.getByRole("textbox", { name: t("outcome.actual_duration") })).toHaveProperty(
      "value",
      "42",
    );
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
    expect(screen.getByRole("group", { name: t("outcome.actual_duration") })).toBeDefined();
    expect(screen.queryByRole("group", { name: t("form.outcome_block") })).toBeNull();
    change(t("outcome.actual_duration"), "55");
    fireEvent.click(button("form.save"));
    expect(await screen.findByRole("heading", { name: t("outcome.saved_hours") })).toBeTruthy();
    expect(await calls(requests, "PUT", "/meetings/meeting-one/outcome")[0]?.json()).toEqual({
      status: "completed",
      actual_duration_minutes: 55,
    });
  },
);

// spec:test meeting-reschedule-cancel-delete#show-confirmation-4-4-title-text
// spec:test meeting-reschedule-cancel-delete#delete-scheduled-meeting-after-confirm
// spec:test meeting-reschedule-cancel-delete#close-confirmation-4-4-keep-meeting
test("keeps a scheduled session on decline and cancels it without a refund option on confirm", async () => {
  setLocation(meetingHref);
  const requests = setup((request, path) => {
    if (path === "/meetings/meeting-one" && request.method === "DELETE")
      return new Response(null, { status: 204 });
  });
  render(view(<MeetingPage />));
  await screen.findByRole("heading", { name: t("form.type_session") });
  function cancelSheet(): ReturnType<typeof within> {
    fireEvent.click(openSessionActions().getByRole("button", { name: t("card.cancel") }));
    return within(screen.getByRole("dialog", { name: t("cancel.title") }));
  }
  const first = cancelSheet();
  expect(first.getByText(t("cancel.text"))).toBeTruthy();
  expect(first.queryByText(t("delete.refund_q"))).toBeNull();
  fireEvent.click(first.getByRole("button", { name: t("cancel.keep") }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByText(t("card.status_planned"))).toBeTruthy();
  expect(calls(requests, "DELETE", "/meetings/meeting-one")).toHaveLength(0);
  fireEvent.click(cancelSheet().getByRole("button", { name: t("cancel.confirm") }));
  await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/app/meetings"));
  const deletes = calls(requests, "DELETE", "/meetings/meeting-one");
  expect(deletes).toHaveLength(1);
  expect(new URL(deletes[0]!.url).searchParams.has("refund")).toBe(false);
});

// spec:test meeting-reschedule-cancel-delete#show-confirmation-4-5-title-text
// spec:test meeting-reschedule-cancel-delete#include-question-refund-q-yes-no-confirmation
// spec:test meeting-reschedule-cancel-delete#keep-meeting-untouched-confirmation-4-4
// spec:test meeting-reschedule-cancel-delete#ask-refund-q-nothing-charged-client
test.each([
  { status: "completed", type: "client_session", charged: true, refund: false },
  { status: "not_taken_place", type: "client_session", charged: true, refund: true },
  { status: "completed", type: "client_session", charged: false, refund: null },
  { status: "completed", type: "personal_therapy", charged: false, refund: null },
] as const)(
  "asks about refund for a $status $type with balance charge=$charged",
  async ({ status, type, charged, refund }) => {
    setLocation(meetingHref);
    const isClient = type === "client_session";
    const original = meeting({
      type,
      status,
      charged,
      payment_type: isClient ? (charged ? "paid" : "barter") : null,
      balance_charge: charged ? { amount: "1900", currency: "RUB" } : null,
      client: isClient ? ref(client()) : null,
      client_card: isClient ? client() : null,
    });
    const requests = setup(
      (request, path) => {
        if (path === "/meetings/meeting-one" && request.method === "DELETE")
          return new Response(null, { status: 204 });
      },
      { meeting: original },
    );
    render(view(<MeetingPage />));
    await screen.findByRole("button", { name: t("extra.meeting_actions") });
    function deleteSheet(): ReturnType<typeof within> {
      fireEvent.click(openSessionActions().getByRole("button", { name: t("card.delete") }));
      return within(screen.getByRole("dialog", { name: t("delete.title") }));
    }
    const first = deleteSheet();
    expect(first.getByText(t("delete.text"))).toBeTruthy();
    fireEvent.click(first.getByRole("button", { name: t("cancel.keep") }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(calls(requests, "DELETE", "/meetings/meeting-one")).toHaveLength(0);
    const next = deleteSheet();
    const deleteButton = next.getByRole("button", { name: t("card.delete") });
    if (refund !== null) {
      const choices = within(next.getByRole("group", { name: t("delete.refund_q") }));
      expect(
        choices.getByRole("button", { name: t("outcome.yes") }).getAttribute("aria-pressed"),
      ).toBe("false");
      expect(
        choices.getByRole("button", { name: t("outcome.no") }).getAttribute("aria-pressed"),
      ).toBe("false");
      expect(deleteButton).toHaveProperty("disabled", true);
      fireEvent.click(
        choices.getByRole("button", { name: t(refund ? "outcome.yes" : "outcome.no") }),
      );
    } else {
      expect(next.queryByText(t("delete.refund_q"))).toBeNull();
      expect(deleteButton).toHaveProperty("disabled", false);
    }
    fireEvent.click(deleteButton);
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/app/meetings"));
    const deletes = calls(requests, "DELETE", "/meetings/meeting-one");
    expect(deletes).toHaveLength(1);
    expect(new URL(deletes[0]!.url).searchParams.get("refund")).toBe(
      refund === null ? null : String(refund),
    );
  },
);

// spec:test client-card-view-edit#show-meetings-block-2-nearest
// spec:test client-card-view-edit#open-screen-6-3-all-meetings-listing
// spec:test client-card-view-edit#open-meeting-card-meeting-tapped
test("shows two nearest sessions in each group on the client card, and all sessions with past prices on the full list", async () => {
  nav.id = "card-one";
  setLocation(cardHref);
  const upcoming = [14, 15, 16].map((hour) =>
    meeting({
      id: "upcoming-" + hour,
      starts_at: date + "T" + hour + ":00:00.000Z",
      awaiting_outcome: false,
    }),
  );
  const pastMeetings = [13, 12, 11].map((hour) =>
    meeting({
      id: "past-" + hour,
      starts_at: "2026-02-10T" + hour + ":00:00.000Z",
      status: "completed",
      price: { amount: "999.75", currency: "RUB" },
      awaiting_outcome: false,
    }),
  );
  const requests = setup((request, path) => {
    if (path === "/clients/card-one/meetings" && request.method === "GET")
      return json({
        upcoming,
        past: pastMeetings,
      });
  });
  render(view(<ClientCardPage />));
  const planned = new RegExp(t("card.status_planned"), "u");
  const completed = new RegExp(t("card.status_done"), "u");
  await screen.findAllByRole("button", { name: planned });
  expect(screen.getAllByRole("button", { name: planned })).toHaveLength(2);
  expect(screen.getAllByRole("button", { name: completed })).toHaveLength(2);
  expect(screen.queryByRole("button", { name: /17:00.*Scheduled/u })).toBeNull();
  expect(screen.queryByRole("button", { name: /12:00.*Completed/u })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /15:00.*Scheduled/u }));
  expect(nav.push).toHaveBeenLastCalledWith("/app/meetings/upcoming-14");
  fireEvent.click(button("client.all_meetings"));
  expect(nav.push).toHaveBeenLastCalledWith(cardHref + "/meetings");

  cleanup();
  setLocation(cardHref + "/meetings");
  render(view(<ClientMeetingsPage />));
  expect(await screen.findByRole("heading", { name: t("c.upcoming") })).toBeTruthy();
  expect(screen.getByRole("heading", { name: t("c.past") })).toBeTruthy();
  expect(screen.getAllByRole("button", { name: planned })).toHaveLength(3);
  expect(screen.getAllByRole("button", { name: completed })).toHaveLength(3);
  expect(screen.getByRole("button", { name: /12:00.*Completed.*999.75 ₽/u })).toBeTruthy();
  expect(
    calls(requests, "GET", "/clients/card-one/meetings").map(({ url }) =>
      new URL(url).searchParams.get("limit"),
    ),
  ).toEqual(["2", null]);
});
