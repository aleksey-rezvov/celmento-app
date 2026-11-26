import { randomUUID } from "node:crypto";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ComponentPropsWithoutRef, ReactElement } from "react";
import { afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import type { Schemas } from "@/lib/api/client";
import { t } from "@/lib/i18n";
import { setSessionToken } from "@/lib/session";
import AppLayout from "./(app)/app/layout";
import AttendedDetail from "./(app)/app/meetings/attended/[id]/page";
import Meetings from "./(app)/app/meetings/page";
import People from "./(app)/app/people/page";
import Book from "./(app)/app/people/specialists/[id]/book/page";
import Specialist from "./(app)/app/people/specialists/[id]/page";

const navigation = vi.hoisted(() => ({
  router: { push: vi.fn(), replace: vi.fn() },
  path: "/app/people",
  id: "",
}));

vi.mock("next/navigation", () => ({
  useRouter: () => navigation.router,
  usePathname: () => navigation.path,
  useParams: () => ({ id: navigation.id }),
  useSearchParams: () => new URLSearchParams(),
}));

interface LinkProps extends ComponentPropsWithoutRef<"a"> {
  onNavigate?: (event: { preventDefault: () => void }) => void;
}

vi.mock("next/link", () => ({
  default: ({ onNavigate, ...props }: LinkProps): ReactElement => (
    <a
      {...props}
      onClick={(event) => {
        event.preventDefault();
        onNavigate?.({ preventDefault: () => undefined });
      }}
    />
  ),
}));

type SpecialistRef = Schemas["SpecialistRef"];
type Meeting = Schemas["AttendedMeeting"];
type Card = Schemas["SpecialistCard"];
type Account = Schemas["Account"];
type Notice = Schemas["Notice"];

const origin = "https://world-api.example.test";
const token = "test-specialists-session";
const me = "019ac7a0-0000-7ab1-b031-111111111111";
const leaderId = "019ac7a0-0000-7ab1-b031-222222222222";
const meetingId = "019ac7a0-0000-7ab1-b031-333333333333";
const otherId = "019ac7a0-0000-7ab1-b031-444444444444";
const now = "2026-11-26T13:00:00Z";
const day = "2026-11-26";
const tomorrow = "2026-11-27";
const firstSlot = tomorrow + "T13:00:00Z";
const laterSlot = tomorrow + "T14:30:00Z";
const pastSlot = "2026-11-25T13:00:00Z";
const accountZone = "Europe/Belgrade";
const photo = origin + "/api/v1/public/photos/specialist.webp";
const call = "https://call.example.test/session";
const peoplePath = "/app/people";
const specialistPath = peoplePath + "/specialists/" + leaderId;
const bookPath = specialistPath + "/book";
const profileApi = "/specialists/" + leaderId;
const slotsApi = profileApi + "/slots";
const attendedApi = "/attended-meetings/" + meetingId;

const leader: SpecialistRef = {
  id: leaderId,
  first_name: "Anna",
  last_name: "Santos",
  photo_url: photo,
  specializations: ["other"],
  specialization_other: "Career counselling",
  time_zone: "Europe/Moscow",
  phone: "+38164123456",
  telegram: "@anna_public",
  whatsapp: "+38164123457",
  contact_email: "public-contact@example.test",
};

function accountFor(activated = false): Account {
  return {
    id: me,
    contour: "world",
    email: "ada-signin@example.test",
    first_name: "Ada",
    last_name: "Lovelace",
    photo_url: null,
    phone: null,
    telegram: null,
    whatsapp: null,
    login: "ada",
    address_url: "https://celmento.com/ada",
    language: "en",
    time_zone: accountZone,
    activated,
    activated_at: activated ? now : null,
    leader: activated
      ? {
          specializations: [],
          specialization_other: null,
          about: "",
          contact_email: null,
          links: [],
          main_channel: null,
          booking_url: "https://celmento.com/ada",
          working_hours: [],
          session_duration_minutes: 60,
          session_format: "online",
          default_meeting_link: null,
          default_rate: null,
          default_currency: "EUR",
          plan: { kind: "free", active_clients: 3, client_limit: 3, subscription_until: null },
        }
      : null,
    acceptances: [],
    created_at: now,
  };
}

function appointment(changes: Partial<Meeting> = {}): Meeting {
  return {
    id: meetingId,
    specialist: leader,
    starts_at: firstSlot,
    duration_minutes: 60,
    place: "online",
    address: null,
    meeting_link: call,
    price: { amount: "95.50", currency: "EUR" },
    payment_type: "paid",
    status: "scheduled",
    charged: null,
    ...changes,
  };
}

function note(index: number, changes: Partial<Schemas["Note"]> = {}): Schemas["Note"] {
  return {
    id: "shared-" + index,
    title: "Shared note " + index,
    text: "Shared with Ada",
    author: { id: leaderId, name: "Anna Santos", photo_url: null },
    folder_id: null,
    tags: [],
    shared_with_me: true,
    can_edit: false,
    created_at: now,
    updated_at: now,
    checked_items: [],
    ...changes,
  };
}

const about = "First line\nSecond line\nThird line\nFourth line";
const contact: Schemas["MainContact"] = { channel: "telegram", value: "@anna_public" };

function card(changes: Partial<Card> = {}): Card {
  return {
    specialist: leader,
    about,
    session_format: "both",
    main_contact: contact,
    payment_type: "paid",
    price_for_me: { amount: "95.50", currency: "EUR" },
    booking_available: true,
    upcoming_meetings: [appointment()],
    past_meetings: [],
    shared_notes: [note(1), note(2), note(3)],
    ...changes,
  };
}

function json(result: unknown, status = 200): Response {
  return new Response(JSON.stringify(result), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function slots(starts: string[], next: string | null = null, hasAvailable = true): Response {
  return json({
    items: starts.map((starts_at) => ({ starts_at, duration_minutes: 60 })),
    next_free_date: next,
    has_available_slots: hasAvailable,
  } satisfies Schemas["BookingSlotList"]);
}

function serve(
  respond: (path: string, request: Request, url: URL) => Response | Promise<Response>,
  account = accountFor(),
): Request[] {
  setSessionToken(token);
  const requests: Request[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (request: Request) => {
      const url = new URL(request.url);
      expect(request.headers.get("authorization")).toBe("Bearer " + token);
      requests.push(request.clone());
      const path = url.pathname.replace(/^\/api\/v1/u, "");
      if (path === "/account") return json(account);
      if (path === "/clients" && account.leader)
        return json({ items: [], plan: account.leader.plan } satisfies Schemas["ClientList"]);
      return respond(path, request, url);
    }),
  );
  return requests;
}

function pathMatches(request: Request, path: string, method = "GET"): boolean {
  return request.method === method && new URL(request.url).pathname === "/api/v1" + path;
}

function page(path: string, element: ReactElement, id = leaderId): ReactElement {
  navigation.path = path;
  navigation.id = id;
  return <AppLayout>{element}</AppLayout>;
}

function refocus(): void {
  act(() => window.dispatchEvent(new Event("focus")));
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
  window.localStorage.clear();
  navigation.router.push.mockReset();
  navigation.router.replace.mockReset();
  vi.stubEnv("NEXT_PUBLIC_CLM_APP_CONTOUR", "world");
  vi.stubEnv("NEXT_PUBLIC_CLM_APP_API_URL", origin);
  vi.spyOn(crypto, "randomUUID").mockImplementation(randomUUID);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(now));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

// spec:test client-my-specialists#show-my-specialists-section-people-tab
// spec:test client-my-specialists#show-listed-leader-photo-name
// spec:test client-my-specialists#open-specialist-card-9-6-account
// spec:test client-my-specialists#show-no-specialists-no-card-linked
// spec:test client-my-specialists#offer-way-add-leader-section
test.each([false, true])(
  "lists specialists and the appropriate empty state with activation %s",
  async (activated) => {
    let linked = true;
    const requests = serve((path) => {
      if (path === "/notices") return json({ items: [] });
      if (path === "/specialists") {
        return json({
          items: linked
            ? [
                { specialist: leader, next_booking_at: "2026-11-26T23:30:00Z" },
                {
                  specialist: { ...leader, id: otherId, first_name: "Mira", photo_url: null },
                  next_booking_at: null,
                },
              ]
            : [],
        } satisfies Schemas["SpecialistList"]);
      }
      throw new Error("Unexpected read " + path);
    }, accountFor(activated));
    render(page(peoplePath, <People />));

    const anna = await screen.findByRole("link", { name: "Anna Santos" });
    expect(anna.getAttribute("href")).toBe(specialistPath);
    const list = within(screen.getByRole("region", { name: t("c.my_specialists") }));
    const annaRow = anna.closest("li");
    if (!annaRow) throw new Error("The specialist's row is missing.");
    expect(within(annaRow).getByText("Career counselling")).toBeDefined();
    expect(anna.closest("li")?.querySelector("img")?.getAttribute("src")).toBe(photo);
    expect(list.getByText("Next booking: 27 November, 00:30")).toBeDefined();
    expect(list.queryByRole("searchbox")).toBeNull();
    expect(list.queryByRole("button")).toBeNull();
    const mira = list.getByRole("link", { name: "Mira Santos" });
    expect(mira.closest("li")?.textContent).toContain("MS");
    expect(mira.closest("li")?.textContent).toContain(t("c.no_bookings_short"));
    expect(screen.queryByRole("heading", { name: t("clients.title") }) !== null).toBe(activated);
    expect(requests.some((request) => pathMatches(request, "/clients"))).toBe(activated);

    linked = false;
    refocus();
    const empty = await list.findByText(t("c.no_specialists"));
    expect(list.queryByRole("link", { name: "Anna Santos" })).toBeNull();
    expect(empty.parentElement?.querySelector("picture img")?.getAttribute("src") ?? null).toBe(
      activated ? null : "/characters/celmento-master-red@200px.png",
    );
    expect(list.queryByRole("link")).toBeNull();
  },
);

// spec:test client-my-specialists#show-card-9-6-leader-photo
// spec:test client-my-specialists#show-contact-buttons-card-9-6
// spec:test client-my-specialists#show-price-for-me-card-9-6-rate
// spec:test client-my-specialists#show-book-card-9-6-starts
// spec:test client-my-specialists#list-card-9-6-upcoming-attended
// spec:test client-my-specialists#list-card-9-6-3-latest
// spec:test client-my-specialists#replace-book-unavailable-bar-leader
// spec:test client-my-specialists#show-list-card-9-6-card
test("keeps shared notes and historical sessions while the specialist's card is archived", async () => {
  let archived = false;
  let restored = false;
  const sharedNotes = [
    note(1),
    note(2),
    note(3),
    note(4),
    note(5, { shared_with_me: false, title: "Private note" }),
  ];
  const past = appointment({ id: otherId, starts_at: pastSlot, status: "completed" });
  serve((path) => {
    if (path !== profileApi) throw new Error("Unexpected read " + path);

    const values = {
      shared_notes: sharedNotes,
      ...(archived
        ? { booking_available: false, upcoming_meetings: [], past_meetings: [past] }
        : {}),
      ...(restored ? { payment_type: "barter" as const } : {}),
    };
    return json({ ...card(values), private_comment: "Hidden card field" });
  });
  render(page(specialistPath, <Specialist />));

  await screen.findByRole("heading", { name: "Anna Santos" });
  expect(screen.getByRole("main").querySelector(".booking-avatar img")?.getAttribute("src")).toBe(
    photo,
  );
  expect(screen.getByText("Career counselling")).toBeDefined();
  expect(screen.getByText(/First line.*Fourth line/u)).toBeDefined();
  expect(screen.getByText("Your session price: 95.50 €")).toBeDefined();
  expect(screen.getByRole("link", { name: t("form.book") }).getAttribute("href")).toBe(bookPath);
  expect(screen.getByRole("link", { name: t("card.call") }).getAttribute("href")).toBe(
    "tel:+38164123456",
  );
  expect(screen.getByRole("link", { name: t("card.telegram") }).getAttribute("href")).toBe(
    "https://t.me/anna_public",
  );
  expect(screen.getByRole("link", { name: t("card.whatsapp") }).getAttribute("href")).toBe(
    "https://wa.me/38164123457",
  );
  expect(screen.getByRole("link", { name: t("card.email") }).getAttribute("href")).toBe(
    "mailto:public-contact@example.test",
  );
  expect(screen.queryByText("Hidden card field")).toBeNull();
  expect(screen.getByRole("link", { name: /27 November · 14:00/u }).getAttribute("href")).toBe(
    "/app/meetings/attended/" + meetingId,
  );
  expect(screen.getAllByText(t("notes.shared_badge"))).toHaveLength(3);
  expect(screen.queryByText("Shared note 4")).toBeNull();
  expect(screen.queryByText("Private note")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Shared note 1" }));
  expect(navigation.router.push).toHaveBeenLastCalledWith("/app/notes/shared-1");

  archived = true;
  refocus();
  const unavailable = await screen.findByText(t("c.unavailable"));
  expect(screen.queryByRole("link", { name: t("form.book") })).toBeNull();
  const unavailableCard = unavailable.closest(".specialist-unavailable");
  if (!(unavailableCard instanceof HTMLElement))
    throw new Error("The unavailable panel is missing.");
  expect(within(unavailableCard).getByRole("link", { name: t("card.telegram") })).toBeDefined();
  expect(
    screen.getByRole("link", { name: /25 November · 14:00.*Completed/u }).getAttribute("href"),
  ).toBe("/app/meetings/attended/" + otherId);
  expect(screen.getAllByText(t("notes.shared_badge"))).toHaveLength(3);

  archived = false;
  restored = true;
  refocus();
  expect(await screen.findByRole("link", { name: t("form.book") })).toBeDefined();
  expect(screen.getByText(t("form.barter"))).toBeDefined();
  expect(screen.queryByText(t("c.unavailable"))).toBeNull();
});

const linkedNotice: Notice = {
  id: "linked-notice",
  key: "client.linked_notice",
  tab: "people",
  params: { specialist_id: leaderId, specialist_name: "Anna Santos" },
  created_at: now,
};

// spec:test client-my-specialists#show-unlink-card-9-6-confirming
// spec:test in-app-notice-bar#produce-bar-linked-notice-leader-name
// spec:test client-card-profile-link#break-link-attendee-taps-unlink
test.each([false, true])(
  "confirms unlinking before removing access from a notice (%s)",
  async (fromNotice) => {
    let linked = true;
    const requests = serve((path, request) => {
      if (path === "/notices") return json({ items: linked ? [linkedNotice] : [] });
      if (path === "/specialists")
        return json({ items: linked ? [{ specialist: leader, next_booking_at: firstSlot }] : [] });
      if (path === profileApi) return linked ? json(card()) : json({ code: "not_found" }, 404);
      if (path === profileApi + "/link" && request.method === "DELETE") {
        linked = false;
        return new Response(null, { status: 204 });
      }
      throw new Error("Unexpected request " + path);
    });
    const view = render(
      fromNotice ? page(peoplePath, <People />) : page(specialistPath, <Specialist />),
    );
    const unlink = await screen.findByRole("button", { name: t("client.unlink") });
    if (fromNotice) expect(await screen.findByRole("link", { name: "Anna Santos" })).toBeDefined();
    fireEvent.click(unlink);
    const first = await screen.findByRole("dialog", { name: t("client.unlink") });
    expect(within(first).getByText(t("extra.specialist_unlink_warning"))).toBeDefined();
    expect(requests.some(({ method }) => method === "DELETE")).toBe(false);
    fireEvent.click(within(first).getByRole("button", { name: t("archive.cancel") }));
    expect(requests.some(({ method }) => method === "DELETE")).toBe(false);

    fireEvent.click(unlink);
    const confirm = await screen.findByRole("dialog", { name: t("client.unlink") });
    fireEvent.click(within(confirm).getByRole("button", { name: t("client.unlink") }));
    if (!fromNotice) {
      await waitFor(() => expect(navigation.router.replace).toHaveBeenCalledWith(peoplePath));
      view.rerender(page(peoplePath, <People />));
    }
    expect(await screen.findByText(t("c.no_specialists"))).toBeDefined();
    expect(
      requests.filter((request) => pathMatches(request, profileApi + "/link", "DELETE")),
    ).toHaveLength(1);
    expect(screen.queryByRole("link", { name: "Anna Santos" })).toBeNull();
    expect(screen.queryByText(t("client.linked_notice", { Name: "Anna Santos" }))).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  },
);

// spec:test client-app-booking#open-slot-picker-book-specialist
// spec:test client-app-booking#offer-booking-account-linked-card
// spec:test client-app-booking#open-form-9-7-after-slot
// spec:test client-app-booking#ask-no-name-email-contact
// spec:test client-app-booking#enable-book-no-format-choice
// spec:test client-app-booking#show-title-after-successful-booking
test.each([false, true])(
  "books an authenticated slot in the account zone with activation %s",
  async (activated) => {
    let attempts = 0;
    const requests = serve((path, _request, url) => {
      if (path === profileApi) return json(card({ session_format: activated ? "online" : "both" }));
      if (path === slotsApi)
        return url.searchParams.get("from") === day ? slots([], tomorrow) : slots([firstSlot]);
      if (path === "/notices") return json({ items: [] } satisfies Schemas["NoticeList"]);
      if (path === "/meetings")
        return json({
          items: [],
          attended: attempts > 1 ? [appointment()] : [],
          attended_total: attempts > 1 ? 1 : 0,
          specialists_count: 1,
          pending_outcomes_count: 0,
          next_outcome_in_seconds: null,
        } satisfies Schemas["MeetingList"]);
      if (path === "/bookings") {
        if (++attempts === 1) throw new TypeError("Interrupted answer");
        return json(appointment(), 201);
      }
      throw new Error("Unexpected request " + path);
    }, accountFor(activated));
    const view = render(page(bookPath, <Book />));

    const next = await screen.findByRole("button", { name: "Next available: 27 November" });
    expect(screen.getByText(t("public.no_slots_day"))).toBeDefined();
    expect(screen.getByText(/Belgrade.*UTC\+1/u)).toBeDefined();
    fireEvent.click(next);
    const selection = await screen.findByRole("button", { name: "14:00" });
    const query = requests.filter((request) => pathMatches(request, slotsApi));
    expect(query.map((request) => new URL(request.url).searchParams.get("from"))).toEqual([
      day,
      tomorrow,
    ]);
    expect(
      query.every((request) => new URL(request.url).searchParams.get("time_zone") === accountZone),
    ).toBe(true);
    fireEvent.click(selection);
    expect(screen.getByRole("heading", { name: "27 November · 14:00" })).toBeDefined();
    const book = screen.getByRole("button", { name: t("form.book") });
    expect(book).toHaveProperty("disabled", !activated);
    expect(screen.queryByRole("textbox", { name: t("form.name") })).toBeNull();
    expect(screen.queryByRole("textbox", { name: t("form.email") })).toBeNull();
    expect(screen.queryByRole("textbox", { name: t("form.contact") })).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
    if (!activated)
      fireEvent.click(screen.getByRole("button", { name: t("profile.format_online") }));
    fireEvent.change(screen.getByRole("textbox", { name: "Comment" }), {
      target: { value: "Evening session" },
    });
    fireEvent.click(book);
    expect((await screen.findByRole("alert")).textContent).toBe(t("extra.auth_network_error"));
    fireEvent.click(book);
    expect(await screen.findByRole("heading", { name: t("done.title") })).toBeDefined();
    expect(
      within(screen.getByRole("main"))
        .getByRole("link", { name: t("meetings.title") })
        .getAttribute("href"),
    ).toBe("/app/meetings");

    const submitted = requests.filter((request) => pathMatches(request, "/bookings", "POST"));
    expect(submitted).toHaveLength(2);
    const keys = submitted.map((request) => request.headers.get("Idempotency-Key"));
    expect(keys[0]).toMatch(/^\w{8}(?:-\w{4}){3}-\w{12}$/u);
    expect(keys[1]).toBe(keys[0]);
    const bodies = await Promise.all(submitted.map((request) => request.json()));
    expect(bodies).toEqual(
      Array<Schemas["AppBookingCreate"]>(2).fill({
        specialist_id: leaderId,
        starts_at: firstSlot,
        comment: "Evening session",
        expected_session_format: activated ? "online" : "both",
        place: activated ? null : "online",
      }),
    );

    view.rerender(page("/app/meetings", <Meetings />));
    expect(await screen.findByRole("button", { name: /Anna Santos/u })).toBeDefined();
    view.rerender(page(specialistPath, <Specialist />));
    expect(
      (await screen.findByRole("link", { name: /27 November · 14:00/u })).getAttribute("href"),
    ).toBe("/app/meetings/attended/" + meetingId);
  },
);

// spec:test client-app-booking#re-check-book-slot-free-show
test("returns to live slots when taken while preserving the booking comment", async () => {
  let slotReads = 0;
  const requests = serve((path) => {
    if (path === profileApi) return json(card({ session_format: "online" }));
    if (path === slotsApi) return slots([++slotReads === 1 ? firstSlot : laterSlot]);
    if (path === "/bookings") return json({ code: "slot_taken" }, 409);
    throw new Error("Unexpected request " + path);
  });
  render(page(bookPath, <Book />));

  fireEvent.click(await screen.findByRole("button", { name: "14:00" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Comment" }), {
    target: { value: "Keep this comment" },
  });
  fireEvent.click(screen.getByRole("button", { name: t("form.book") }));
  const taken = await screen.findByRole("dialog", { name: t("form.slot_taken") });
  fireEvent.click(within(taken).getByRole("button", { name: t("extra.close") }));
  expect(screen.queryByRole("button", { name: "14:00" })).toBeNull();
  fireEvent.click(await screen.findByRole("button", { name: "15:30" }));
  expect(screen.getByRole("textbox", { name: "Comment" })).toHaveProperty(
    "value",
    "Keep this comment",
  );
  expect(requests.filter((request) => pathMatches(request, "/bookings", "POST"))).toHaveLength(1);
});

test("replaces changed app booking format without changing the comment and gives the new body its own key", async () => {
  let current: Schemas["SessionFormat"] = "online";
  const requests = serve((path) => {
    if (path === profileApi) return json(card({ session_format: current }));
    if (path === slotsApi) return slots([firstSlot]);
    if (path === "/bookings") {
      if (current === "online") {
        current = "both";
        return json({ code: "conflict" }, 409);
      }
      return json(appointment({ place: "in_person" }), 201);
    }
    throw new Error("Unexpected request " + path);
  });
  render(page(bookPath, <Book />));

  fireEvent.click(await screen.findByRole("button", { name: "14:00" }));
  const comment = screen.getByRole("textbox", { name: "Comment" });
  fireEvent.change(comment, { target: { value: "Retain my comment" } });
  const book = screen.getByRole("button", { name: t("form.book") });
  expect(book).toHaveProperty("disabled", false);
  fireEvent.click(book);
  const inPerson = await screen.findByRole("button", { name: t("profile.format_offline") });
  expect(book).toHaveProperty("disabled", true);
  expect(comment).toHaveProperty("value", "Retain my comment");
  fireEvent.click(inPerson);
  fireEvent.click(book);
  expect(await screen.findByRole("heading", { name: t("done.title") })).toBeDefined();

  const writes = requests.filter((request) => pathMatches(request, "/bookings", "POST"));
  expect(writes).toHaveLength(2);
  expect(writes[0]?.headers.get("Idempotency-Key")).not.toBe(
    writes[1]?.headers.get("Idempotency-Key"),
  );
  expect(await writes[0]?.json()).toMatchObject({ expected_session_format: "online", place: null });
  expect(await writes[1]?.json()).toMatchObject({
    expected_session_format: "both",
    place: "in_person",
    comment: "Retain my comment",
  });
});

// spec:test client-app-booking#show-screen-9-4-notify-leader
test.each(["profile", "slots"] as const)(
  "records one explicit booking attempt when archive is discovered in %s",
  async (surface) => {
    let archived = true;
    const requests = serve((path, request) => {
      if (path === profileApi)
        return json(card({ booking_available: !archived || surface === "slots" }));
      if (path === slotsApi) {
        if (!archived) return slots([firstSlot]);
        return json({ code: "booking_unavailable", details: { main_contact: contact } }, 409);
      }
      if (path === "/bookings" && request.method === "POST")
        return json({ code: "booking_unavailable", details: { main_contact: contact } }, 409);
      throw new Error("Unexpected request " + path);
    });
    const view = render(page(bookPath, <Book />));
    const message = t("unavailable.text", { name: "Anna Santos" });
    expect(await screen.findByRole("heading", { name: message })).toBeDefined();
    expect(screen.getByRole("link", { name: t("card.telegram") })).toBeDefined();
    expect(requests.some(({ method }) => method === "POST")).toBe(false);

    archived = false;
    view.rerender(page(specialistPath, <Specialist />));
    const entry = await screen.findByRole("link", { name: t("form.book") });
    fireEvent.click(entry);
    archived = true;
    view.rerender(page(bookPath, <Book />));
    expect(await screen.findByRole("heading", { name: message })).toBeDefined();
    await waitFor(() =>
      expect(requests.some((request) => pathMatches(request, "/bookings", "POST"))).toBe(true),
    );
    refocus();
    const attempts = requests.filter((request) => pathMatches(request, "/bookings", "POST"));
    expect(attempts).toHaveLength(1);
    expect(await attempts[0]?.json()).toEqual({ specialist_id: leaderId });
    expect(attempts[0]?.headers.get("Idempotency-Key")).toMatch(/^\w{8}-/u);
  },
);

test("shows the latest specialist contact if the card is archived during form submission", async () => {
  const requests = serve((path) => {
    if (path === profileApi) return json(card({ session_format: "online" }));
    if (path === slotsApi) return slots([firstSlot]);
    if (path === "/bookings")
      return json(
        {
          code: "booking_unavailable",
          details: { main_contact: { channel: "email", value: "updated@example.test" } },
        },
        409,
      );
    throw new Error("Unexpected request " + path);
  });
  render(page(bookPath, <Book />));

  fireEvent.click(await screen.findByRole("button", { name: "14:00" }));
  fireEvent.click(screen.getByRole("button", { name: t("form.book") }));
  await screen.findByRole("heading", { name: t("unavailable.text", { name: "Anna Santos" }) });
  expect(screen.getByRole("link", { name: t("card.email") }).getAttribute("href")).toBe(
    "mailto:updated@example.test",
  );
  expect(screen.queryByRole("link", { name: t("card.telegram") })).toBeNull();
  expect(requests.filter((request) => pathMatches(request, "/bookings", "POST"))).toHaveLength(1);
});

// spec:test client-app-booking#offer-booking-app-leader-card
test.each([me, otherId])(
  "does not present a booking form for a nonlinked or own leader",
  async (id) => {
    const requests = serve((path) => {
      if (path === "/specialists/" + otherId) return json({ code: "not_found" }, 404);
      throw new Error("Unexpected request " + path);
    }, accountFor(true));
    render(page(peoplePath + "/specialists/" + id + "/book", <Book />, id));

    expect(await screen.findByText(t("public.not_found"))).toBeDefined();
    expect(screen.queryByRole("button", { name: t("form.book") })).toBeNull();
    expect(requests.some((request) => pathMatches(request, "/bookings", "POST"))).toBe(false);
    expect(requests.some((request) => pathMatches(request, "/specialists/" + me))).toBe(false);
  },
);

test("shows only the main contact when the four-week horizon has no available slots", async () => {
  serve((path) => {
    if (path === profileApi) return json(card());
    if (path === slotsApi) return slots([], null, false);
    throw new Error("Unexpected request " + path);
  });
  render(page(bookPath, <Book />));
  expect(await screen.findByText(t("public.no_slots_all"))).toBeDefined();
  expect(screen.queryByRole("group", { name: t("form.date") })).toBeNull();
  expect(screen.getByRole("link", { name: t("card.telegram") })).toBeDefined();
});

// spec:test attended-meetings#show-screen-9-9-leader-photo
// spec:test attended-meetings#offer-screen-9-9-open-meeting-meeting
// spec:test attended-meetings#show-screen-9-9-contact-buttons
// spec:test attended-meetings#show-in-person-meeting-address
// spec:test attended-meetings#show-actual-duration-leader-comment
// spec:test attended-meetings#offer-cancel-reschedule-delete-outcome
test("shows authorized meeting details, downloads the calendar and removes access on a later read", async () => {
  let meeting: Meeting | null = appointment();
  const create = vi.fn(() => "blob:https://example.test/calendar");
  const revoke = vi.fn();
  const downloads: string[] = [];
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = create;
      static revokeObjectURL = revoke;
    },
  );
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    downloads.push(this.download);
  });
  const requests = serve((path) => {
    if (path === attendedApi)
      return meeting
        ? json({
            ...meeting,
            actual_duration_minutes: 185,
            comment: "Private meeting context",
          })
        : json({ code: "not_found" }, 404);
    if (path === attendedApi + "/calendar.ics")
      return new Response("BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n", {
        headers: { "content-type": "text/calendar" },
      });
    throw new Error("Unexpected request " + path);
  });
  render(page("/app/meetings/attended/" + meetingId, <AttendedDetail />, meetingId));

  await screen.findByRole("heading", { name: "Anna Santos" });
  expect(screen.getByRole("main").querySelector(".booking-avatar img")?.getAttribute("src")).toBe(
    photo,
  );
  expect(screen.getByText("27 November · 14:00")).toBeDefined();
  expect(screen.getByText("specialist's time 16:00")).toBeDefined();
  expect(screen.getByText(t("public.duration", { N: 60 }))).toBeDefined();
  expect(screen.getByText(t("public.price", { amount: "95.50 €" }))).toBeDefined();
  expect(screen.getByText(t("profile.format_online"))).toBeDefined();
  expect(screen.getByText(call)).toBeDefined();
  expect(screen.getByRole("link", { name: t("card.open_meeting") }).getAttribute("href")).toBe(
    call,
  );
  expect(screen.getByRole("link", { name: t("card.email") }).getAttribute("href")).toBe(
    "mailto:public-contact@example.test",
  );
  expect(screen.getByText(t("c.contact_to_change"))).toBeDefined();
  expect(screen.queryByText("Private meeting context")).toBeNull();
  expect(screen.queryByText(t("public.duration", { N: 185 }))).toBeNull();
  expect(
    within(screen.getByRole("main"))
      .getAllByRole("button")
      .map(({ textContent }) => textContent),
  ).toEqual([t("done.add_calendar")]);

  fireEvent.click(screen.getByRole("button", { name: t("done.add_calendar") }));
  await waitFor(() => expect(downloads).toEqual(["celmento-session.ics"]));
  expect(create).toHaveBeenCalledOnce();
  expect(
    requests.filter((request) => pathMatches(request, attendedApi + "/calendar.ics")),
  ).toHaveLength(1);

  meeting = appointment({
    place: "in_person",
    meeting_link: null,
    address: "Studio 7, First Avenue",
    starts_at: pastSlot,
    status: "not_taken_place",
    charged: true,
    payment_type: "pro_bono",
  });
  refocus();
  expect(await screen.findByText("Address · Studio 7, First Avenue")).toBeDefined();
  expect(screen.getByText(t("c.status_missed_charged"))).toBeDefined();
  expect(screen.getByText(t("form.pro_bono"))).toBeDefined();
  expect(screen.queryByRole("link", { name: t("card.open_meeting") })).toBeNull();

  meeting = null;
  refocus();
  expect(await screen.findByText(t("extra.meeting_missing"))).toBeDefined();
  expect(screen.queryByText("Address · Studio 7, First Avenue")).toBeNull();
  expect(screen.queryByRole("button", { name: t("done.add_calendar") })).toBeNull();
});

test("rejects a submit from an earlier session before React has replaced its form", async () => {
  const requests = serve((path) => {
    if (path === profileApi) return json(card({ session_format: "online" }));
    if (path === slotsApi) return slots([firstSlot]);
    throw new Error("Unexpected request " + path);
  });
  render(page(bookPath, <Book />));

  fireEvent.click(await screen.findByRole("button", { name: "14:00" }));
  const oldSubmit = screen.getByRole("button", { name: t("form.book") });
  expect(oldSubmit).toHaveProperty("disabled", false);
  window.localStorage.setItem("celmento_app_session", "new-session-before-repaint");
  fireEvent.click(oldSubmit);
  expect(requests.some(({ method }) => method === "POST")).toBe(false);
});

test.each(["network", "overloaded"] as const)(
  "retries the original archived booking intent after a %s failure",
  async (failure) => {
    let archived = false;
    let submissions = 0;
    const timers = vi.spyOn(window, "setTimeout");
    const requests = serve((path, request) => {
      if (path === profileApi) return json(card({ booking_available: !archived }));
      if (path === "/bookings" && request.method === "POST") {
        if (++submissions === 1) {
          if (failure === "network") throw new TypeError("The response was lost.");
          return json({ code: "internal_error" }, 503);
        }
        return json(
          {
            code: "booking_unavailable",
            details: { main_contact: { channel: "email", value: "after-archive@example.test" } },
          },
          409,
        );
      }
      throw new Error("Unexpected request " + path);
    });
    const view = render(page(specialistPath, <Specialist />));
    fireEvent.click(await screen.findByRole("link", { name: t("form.book") }));
    archived = true;
    view.rerender(page(bookPath, <Book />));
    await screen.findByRole("heading", {
      name: t("unavailable.text", { name: "Anna Santos" }),
    });

    await waitFor(() => expect(timers).toHaveBeenCalledWith(expect.any(Function), 750));
    expect(submissions).toBe(1);
    const onRetry = timers.mock.calls.find(([, delay]) => delay === 750)?.[0];
    if (typeof onRetry !== "function") throw new Error("The booking notice is missing its retry.");
    act(onRetry);
    const email = await screen.findByRole("link", { name: t("card.email") });
    expect(email.getAttribute("href")).toBe("mailto:after-archive@example.test");
    const writes = requests.filter((request) => pathMatches(request, "/bookings", "POST"));
    expect(writes).toHaveLength(2);
    expect(writes[0]?.headers.get("Idempotency-Key")).toBe(
      writes[1]?.headers.get("Idempotency-Key"),
    );
    expect(await Promise.all(writes.map((request) => request.json()))).toEqual(
      Array<Schemas["AppBookingCreate"]>(2).fill({ specialist_id: leaderId }),
    );
  },
);

test("returns to fresh slots if the archived specialist's card is restored before the attempt", async () => {
  let archived = false;
  let restored = false;
  const requests = serve((path, request) => {
    if (path === profileApi)
      return json(
        card({ booking_available: !archived, session_format: restored ? "in_person" : "both" }),
      );
    if (path === slotsApi && restored) return slots([firstSlot]);
    if (path === "/bookings" && request.method === "POST") {
      archived = false;
      restored = true;
      return json({ code: "validation_error" }, 422);
    }
    throw new Error("Unexpected request " + path);
  });
  const view = render(page(specialistPath, <Specialist />));
  fireEvent.click(await screen.findByRole("link", { name: t("form.book") }));
  archived = true;
  view.rerender(page(bookPath, <Book />));

  const fresh = await screen.findByRole("button", { name: "14:00" });
  expect(screen.queryByText(t("unavailable.text", { name: "Anna Santos" }))).toBeNull();
  expect(requests.filter((request) => pathMatches(request, profileApi))).toHaveLength(3);
  expect(requests.filter((request) => pathMatches(request, "/bookings", "POST"))).toHaveLength(1);
  expect(requests.filter((request) => pathMatches(request, slotsApi))).toHaveLength(1);
  fireEvent.click(fresh);
  expect(screen.getByText(t("profile.format_offline"))).toBeDefined();
  expect(screen.getByRole("button", { name: t("form.book") })).toHaveProperty("disabled", false);
});
