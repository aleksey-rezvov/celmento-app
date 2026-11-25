import { webcrypto } from "node:crypto";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
  type RenderResult,
} from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import type { Schemas } from "@/lib/api/client";
import { t } from "@/lib/i18n";
import {
  loadCode,
  loadEmail,
  loadIntent,
  loadOrigin,
  loadPackage,
  loadSignupEmail,
  saveIntent,
  saveOrigin,
  savePackage,
  startCode,
} from "@/lib/registration";
import AuthLayout from "./(auth)/layout";
import Login from "./(auth)/login/page";
import BookPage from "./[login]/book/page";
import DonePage from "./[login]/done/page";
import PublicLayout from "./[login]/layout";
import InvitePage from "./[login]/meet/[id]/page";
import PublicPage from "./[login]/page";
import UnavailablePage from "./[login]/unavailable/page";

const navigation = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  login: "adalovelace",
  id: "",
}));
vi.mock("next/navigation", () => ({
  useRouter: () => navigation,
  useParams: () => ({ login: navigation.login, id: navigation.id }),
}));
vi.mock("@/lib/device", async (original) => ({
  ...(await original<typeof import("@/lib/device")>()),
  deviceTimeZone: () => "Europe/Belgrade",
}));

type Specialist = Schemas["PublicSpecialistPage"];
type Invite = Schemas["MeetingInvitePage"];
const api = "https://world-api.example.test";
const otherApi = "https://ru-api.example.test";
const login = "adalovelace";
const base = "/" + login;
const profile = "/public/specialists/" + login;
const slots = profile + "/slots";
const bookingId = "019ac7a0-0000-7ab1-b031-111111111111";
const inviteId = "019ac7a0-0000-7ab1-b031-222222222222";
const invitePath = profile + "/meet/" + inviteId;
const today = "2026-11-26";
const tomorrow = "2026-11-27";
const firstSlot = today + "T13:00:00Z";
const anotherSlot = today + "T14:00:00Z";
const tomorrowSlot = tomorrow + "T14:30:00Z";
const callUrl = "https://call.example.test/approved";
const context = "opaque-booking-context";
const guestEmail = "guest@example.test";

function specialist(changes: Partial<Specialist> = {}): Specialist {
  return {
    login,
    booking_context: context,
    first_name: "Ada",
    last_name: "Lovelace",
    photo_url: null,
    specializations: ["coach"],
    specialization_other: null,
    about: "First line\nSecond line\nThird line\nFourth line",
    price: { amount: "123.45", currency: "EUR" },
    session_duration_minutes: 60,
    session_format: "both",
    main_contact: { channel: "telegram", value: "@ada_coach" },
    ...changes,
  };
}

function slotList(starts: string[], next: string | null = null, available = true): Response {
  return json({
    items: starts.map((starts_at) => ({ starts_at, duration_minutes: 60 })),
    next_free_date: next,
    has_available_slots: available,
  } satisfies Schemas["BookingSlotList"]);
}

function invite(changes: Partial<Invite> = {}): Invite {
  return {
    specialist_first_name: "Ada",
    specialist_last_name: "Lovelace",
    photo_url: null,
    specializations: ["coach"],
    specialization_other: null,
    starts_at: firstSlot,
    duration_minutes: 60,
    place: "online",
    meeting_link: callUrl,
    address: null,
    ...changes,
  };
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function publicApi(
  handle: (request: Request, path: string, url: URL) => Response | Promise<Response>,
): Request[] {
  const requests: Request[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (request: Request) => {
      const url = new URL(request.url);
      if (url.origin !== api) throw new Error("Unexpected API origin.");
      const path = url.pathname.replace(/^\/api\/v1/u, "");
      requests.push(request.clone());
      if (path.startsWith("/documents/")) {
        const kind = path.replace("/documents/", "");
        return json({
          kind,
          contour: "world",
          language: url.searchParams.get("language"),
          title:
            kind === "terms_of_use"
              ? "Terms of Use"
              : kind === "personal_data_consent"
                ? "Personal data consent"
                : "Privacy Policy",
          version: kind === "terms_of_use" ? "terms-2" : "privacy-3",
          text:
            kind === "personal_data_consent"
              ? "Read our Privacy Policy for details."
              : "Current document.",
        });
      }
      return handle(request, path, url);
    }),
  );
  return requests;
}

function calls(requests: Request[], path: string, method = "GET"): Request[] {
  return requests.filter(
    (request) => request.method === method && new URL(request.url).pathname === "/api/v1" + path,
  );
}

function at(path: string, page: ReactElement): ReactElement {
  window.history.replaceState(null, "", path);
  return <PublicLayout>{page}</PublicLayout>;
}

function button(key: Parameters<typeof t>[0]): HTMLElement {
  return screen.getByRole("button", { name: t(key) });
}

function fill(label: string, value: string): void {
  fireEvent.change(screen.getByRole("textbox", { name: label }), { target: { value } });
}

async function openSlot(view: RenderResult, text = "14:00"): Promise<void> {
  fireEvent.click(await screen.findByRole("button", { name: text }));
  expect(navigation.push).toHaveBeenLastCalledWith(base + "/book");
  view.rerender(at(base + "/book", <BookPage />));
  await screen.findByRole("textbox", { name: t("form.name") });
}

async function acceptConsent(): Promise<void> {
  const terms = screen.getByRole("checkbox", { name: t("signup.terms") });
  const privacy = screen.getByRole("checkbox", { name: t("signup.privacy") });
  await waitFor(() => expect(terms).toHaveProperty("disabled", false));
  fireEvent.click(terms);
  fireEvent.click(privacy);
}

function oldRegistration(origin: Schemas["RegistrationOrigin"] | null): void {
  savePackage({
    token: "previously-signed-package",
    claims: {
      email: guestEmail,
      first_name: "Previously",
      last_name: "Entered",
      consents: [],
      intent: origin ? null : "lead",
      origin,
      entry_contour: "world",
      code_confirmed: true,
      issued_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 60 * 60_000).toISOString(),
      device_public_key: "previous-public-key",
    },
  });
  if (origin) saveOrigin(origin);
  startCode(guestEmail, "Previous");
}

function calendarDownload(): ReturnType<typeof vi.fn> {
  const create = vi.fn(() => "blob:https://localhost/calendar");
  const currentURL = URL;
  vi.stubGlobal(
    "URL",
    class extends currentURL {
      static createObjectURL = create;
      static revokeObjectURL = vi.fn();
    },
  );
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
  return create;
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
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.stubEnv("NEXT_PUBLIC_CLM_APP_CONTOUR", "world");
  vi.stubEnv("NEXT_PUBLIC_CLM_APP_API_URL", api);
  vi.stubEnv("NEXT_PUBLIC_CLM_APP_OTHER_ZONE_API_URL", otherApi);
  vi.stubGlobal("crypto", webcrypto);
  vi.spyOn(navigator, "language", "get").mockReturnValue("en-GB");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(today + "T09:00:00Z"));
  navigation.login = login;
  navigation.id = inviteId;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

// spec:test public-booking-page#open-screen-9-1-domain-login
// spec:test public-booking-page#show-top-leader-photo-first
// spec:test public-booking-page#show-price-leader-default-rate
// spec:test public-booking-page#show-duration-leader-session-duration
// spec:test public-booking-page#show-leader-main-contact-channel
// spec:test public-booking-page#show-date-strip-today-4-weeks
// spec:test public-booking-page#render-date-slot-time-guest
// spec:test public-booking-page#show-no-slots-day-next-free-button
// spec:test public-booking-page#open-booking-form-guest-taps
test("opens the public profile and shows the next free device-local day and slot", async () => {
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(100);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(50);
  const requests = publicApi((_request, path, url) => {
    if (path === profile) return json(specialist());
    if (path === slots)
      return url.searchParams.get("from") === today
        ? slotList([], tomorrow)
        : slotList([tomorrowSlot], tomorrow);
    throw new Error("Unexpected request " + path);
  });
  render(at(base, <PublicPage />));
  expect(await screen.findByRole("heading", { name: "Ada Lovelace" })).toBeTruthy();
  expect(screen.getByText("AL")).toBeTruthy();
  expect(screen.getByText(t("extra.profile_coach"))).toBeTruthy();
  expect(screen.getByText(t("public.price", { amount: "123.45 €" }))).toBeTruthy();
  expect(screen.getByText("60 minutes · Online and in person")).toBeTruthy();
  const contact = screen.getByRole("link", { name: t("card.telegram") });
  expect(contact.getAttribute("href")).toBe("https://t.me/ada_coach");
  const about = screen.getByText("First line Second line Third line Fourth line");
  expect(about.getAttribute("data-expanded")).toBe("false");
  fireEvent.click(button("public.more"));
  expect(about.getAttribute("data-expanded")).toBe("true");
  expect(screen.queryByRole("button", { name: t("public.more") })).toBeNull();
  const dates = within(screen.getByRole("group", { name: t("form.date") }));
  expect(dates.getAllByRole("button")).toHaveLength(29);
  expect(dates.getByRole("button", { name: "26 November" }).getAttribute("aria-pressed")).toBe(
    "true",
  );
  expect(screen.getByText(t("public.tz_label", { city: "Belgrade", "±N": "+1" }))).toBeTruthy();
  expect(await screen.findByText(t("public.no_slots_day"))).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", { name: t("public.next_free", { date: "27 November" }) }),
  );
  const picked = await screen.findByRole("button", { name: "15:30" });
  expect(picked.querySelector("time")?.dateTime).toBe(tomorrowSlot);
  expect(dates.getByRole("button", { name: "27 November" }).getAttribute("aria-pressed")).toBe(
    "true",
  );
  fireEvent.click(picked);
  expect(navigation.push).toHaveBeenLastCalledWith(base + "/book");
  expect(calls(requests, slots).map((request) => [...new URL(request.url).searchParams])).toEqual([
    [
      ["from", today],
      ["to", today],
      ["time_zone", "Europe/Belgrade"],
    ],
    [
      ["from", tomorrow],
      ["to", tomorrow],
      ["time_zone", "Europe/Belgrade"],
    ],
  ]);
  expect(requests.every((request) => !request.headers.has("Authorization"))).toBe(true);
});

// spec:test public-booking-page#replace-date-strip-slots-no-slots-all
test("distinguishes an empty selected day from no slots anywhere, even on a later date", async () => {
  publicApi((_request, path, url) => {
    if (path === profile) return json(specialist({ price: null, about: "" }));
    if (path === slots) {
      const day = url.searchParams.get("from");
      if (day === today) return slotList([firstSlot], today);
      return slotList([], null, day === tomorrow);
    }
    throw new Error("Unexpected request " + path);
  });
  render(at(base, <PublicPage />));
  await screen.findByRole("button", { name: "14:00" });
  expect(screen.queryByText(/^Session price/u)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "27 November" }));
  expect(await screen.findByText(t("public.no_slots_day"))).toBeTruthy();
  expect(screen.getByRole("button", { name: "28 November" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "28 November" }));
  expect(await screen.findByText(t("public.no_slots_all"))).toBeTruthy();
  expect(screen.queryByRole("group", { name: t("form.date") })).toBeNull();
  expect(screen.getByRole("link", { name: t("card.telegram") })).toBeTruthy();
});

// spec:test public-booking-page#show-not-found-page-character-link
// spec:test interface-language#show-public-pages-not-found-page
test.each([
  ["ru-RU", "ru"],
  ["fr-FR", "en"],
] as const)("shows the browser-localized not-found page on %s", async (browser, language) => {
  vi.spyOn(navigator, "language", "get").mockReturnValue(browser);
  const requests = publicApi(() => json({ code: "not_found" }, 404));
  render(at(base, <PublicPage />));
  expect(
    await screen.findByRole("heading", { name: t("public.not_found", undefined, language) }),
  ).toBeTruthy();
  expect(
    screen
      .getByRole("link", { name: t("extra.celmento_site", undefined, language) })
      .getAttribute("href"),
  ).toBe("/");
  expect(screen.getByRole("main").querySelector("img")?.getAttribute("src")).toContain(
    "master-red",
  );
  expect(requests).toHaveLength(1);
});

// spec:test guest-booking-flow#open-form-9-2-after-guest
// spec:test guest-booking-flow#ask-name-required-field-name-hint
// spec:test guest-booking-flow#offer-contact-one-optional-free-text
// spec:test guest-booking-flow#show-required-format-choice
// spec:test guest-booking-flow#show-two-separate-unchecked-consent
// spec:test guest-booking-flow#keep-book-disabled-until-required
// spec:test guest-booking-flow#ask-payment-booking-require-anything
// spec:test guest-booking-flow#open-screen-9-3-after-successful
// spec:test guest-booking-flow#offer-save-device-calendar-event
// spec:test guest-booking-flow#open-sign-in-leader-contour-domain
// spec:test legal-documents#make-privacy-policy-reachable-text
// spec:test registration-intent-screen#show-screen-1-0-person-arrives
test("books with versioned consents, retries the unchanged body, and preserves the confirmation during delayed navigation and reload", async () => {
  const download = calendarDownload();
  let submissions = 0;
  const requests = publicApi((request, path) => {
    if (path === profile) return json(specialist());
    if (path === slots) return slotList([firstSlot, anotherSlot], today);
    if (path === "/public/bookings" && request.method === "POST") {
      if (++submissions < 3) throw new TypeError("The response was lost.");
      return json(
        {
          id: bookingId,
          specialist_name: "Ada Lovelace",
          starts_at: anotherSlot,
          place: "online",
          meeting_link: callUrl,
          email: guestEmail,
        } satisfies Schemas["GuestBookingConfirmation"],
        201,
      );
    }
    if (path === "/public/bookings/" + bookingId + "/calendar.ics") {
      return new Response("BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n", {
        headers: { "Content-Type": "text/calendar" },
      });
    }
    throw new Error("Unexpected request " + path);
  });
  let view = render(at(base, <PublicPage />));
  await openSlot(view);
  expect(screen.getByRole("heading", { name: "26 November · 14:00" })).toBeTruthy();
  expect(screen.getByText(t("form.name_hint"))).toBeTruthy();
  expect(screen.getByText(t("form.email_hint"))).toBeTruthy();
  expect(screen.getByText(t("form.contact_hint"))).toBeTruthy();
  expect(screen.getByText(t("form.comment_hint"))).toBeTruthy();
  expect(screen.getByRole("textbox", { name: t("form.name") })).toHaveProperty("required", true);
  expect(screen.getByRole("textbox", { name: t("form.email") })).toHaveProperty("required", true);
  expect(screen.getByRole("textbox", { name: t("form.contact") })).toHaveProperty(
    "required",
    false,
  );
  const terms = screen.getByRole("checkbox", { name: t("signup.terms") });
  const privacy = screen.getByRole("checkbox", { name: t("signup.privacy") });
  expect(terms).toHaveProperty("checked", false);
  expect(privacy).toHaveProperty("checked", false);
  expect(screen.getAllByRole("checkbox")).toHaveLength(2);
  expect(button("form.book")).toHaveProperty("disabled", true);
  fill(t("form.name"), "Booking guest");
  fill(t("form.email"), "invalid");
  expect(button("form.book")).toHaveProperty("disabled", true);
  fill(t("form.email"), "Guest@Example.Test");
  fill(t("form.contact"), "@reach_me");
  fill("Comment", "Original note");
  await acceptConsent();
  expect(button("form.book")).toHaveProperty("disabled", true);
  fireEvent.click(button("profile.format_online"));
  expect(button("form.book")).toHaveProperty("disabled", false);

  fireEvent.click(button("extra.auth_consent_link"));
  const consentDialog = within(
    await screen.findByRole("dialog", { name: "Personal data consent" }),
  );
  fireEvent.click(consentDialog.getByRole("button", { name: "Privacy Policy" }));
  await screen.findByRole("dialog", { name: "Privacy Policy" });
  fireEvent.click(button("extra.auth_close_document"));
  fireEvent.click(button("profile.privacy"));
  expect(await screen.findByRole("dialog", { name: "Privacy Policy" })).toBeTruthy();
  fireEvent.click(button("extra.auth_close_document"));
  expect(terms).toHaveProperty("checked", true);
  expect(privacy).toHaveProperty("checked", true);
  expect(screen.getByRole("textbox", { name: "Comment" })).toHaveProperty("value", "Original note");
  expect(screen.getByRole("link", { name: t("form.change_time") }).getAttribute("href")).toBe(base);
  expect(calls(requests, "/public/bookings", "POST")).toHaveLength(0);

  view.rerender(at(base, <PublicPage />));
  await openSlot(view, "15:00");
  expect(screen.getByRole("heading", { name: "26 November · 15:00" })).toBeTruthy();
  expect(screen.getByRole("textbox", { name: t("form.email") })).toHaveProperty(
    "value",
    "Guest@Example.Test",
  );
  expect(screen.getByRole("textbox", { name: t("form.contact") })).toHaveProperty(
    "value",
    "@reach_me",
  );
  await waitFor(() => expect(button("form.book")).toHaveProperty("disabled", false));
  fireEvent.click(button("form.book"));
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    t("extra.auth_network_error"),
  );

  view.unmount();
  view = render(at(base + "/book", <BookPage />));
  await screen.findByRole("textbox", { name: t("form.name") });
  await waitFor(() => expect(button("form.book")).toHaveProperty("disabled", false));
  fireEvent.click(button("form.book"));
  await screen.findByRole("alert");
  fill("Comment", "A changed note");
  fireEvent.click(button("form.book"));
  await waitFor(() => expect(navigation.replace.mock.calls).toEqual([[base + "/done"]]));
  expect(screen.queryByRole("button", { name: t("form.book") })).toBeNull();

  const attempts = calls(requests, "/public/bookings", "POST");
  expect(attempts).toHaveLength(3);
  const keys = attempts.map((request) => request.headers.get("Idempotency-Key"));
  expect(keys[0]).toMatch(/^[\da-f-]{36}$/iu);
  expect(keys[1]).toBe(keys[0]);
  expect(keys[2]).not.toBe(keys[1]);
  const bodies = await Promise.all(attempts.map((request) => request.json()));
  expect(bodies[0]).toEqual({
    login,
    booking_context: context,
    starts_at: anotherSlot,
    name: "Booking guest",
    email: guestEmail,
    contact: "@reach_me",
    comment: "Original note",
    place: "online",
    consents: [
      { document: "terms_of_use", version: "terms-2" },
      { document: "personal_data_consent", version: "privacy-3" },
    ],
    language: "en",
    time_zone: "Europe/Belgrade",
  });
  expect(bodies[1]).toEqual(bodies[0]);
  expect(bodies[2]).toEqual({ ...bodies[0], comment: "A changed note" });
  expect(JSON.stringify(navigation.push.mock.calls)).not.toContain(guestEmail);

  view.unmount();
  navigation.replace.mockClear();
  view = render(at(base + "/book", <BookPage />));
  await waitFor(() => expect(navigation.replace.mock.calls).toEqual([[base + "/done"]]));
  view.rerender(at(base + "/done", <DonePage />));
  expect(await screen.findByRole("heading", { name: t("done.title") })).toBeTruthy();
  expect(screen.getByText("Ada Lovelace")).toBeTruthy();
  expect(screen.getByText("26 November · 15:00")).toBeTruthy();
  expect(screen.getByText(t("profile.format_online"))).toBeTruthy();
  expect(screen.getByRole("link", { name: t("meet.join") }).getAttribute("href")).toBe(callUrl);
  fireEvent.click(button("done.add_calendar"));
  await waitFor(() => expect(download).toHaveBeenCalledTimes(1));
  expect(calls(requests, "/public/bookings/" + bookingId + "/calendar.ics")).toHaveLength(1);

  oldRegistration({ page: "meeting_invite", login, meeting_id: inviteId });
  expect(loadPackage()).not.toBeNull();
  expect(loadCode()).not.toBeNull();
  fireEvent.click(button("done.open_app"));
  expect(navigation.push).toHaveBeenLastCalledWith("/login");
  expect(loadPackage()).toBeNull();
  expect(loadCode()).toBeNull();
  expect(loadOrigin()).toEqual({ page: "public_booking", login, meeting_id: null });
  expect(loadEmail()).toBe(guestEmail);
  window.history.replaceState(null, "", "/login");
  view.rerender(
    <AuthLayout>
      <Login />
    </AuthLayout>,
  );
  expect(await screen.findByRole("textbox", { name: t("login.email") })).toHaveProperty(
    "value",
    guestEmail,
  );
  expect(screen.queryByText(t("start.title"))).toBeNull();
});

// spec:test guest-booking-flow#re-check-book-slot-free-taken
test("returns a taken booking to fresh slots without requesting the same fields again", async () => {
  let taken = false;
  const requests = publicApi((request, path) => {
    if (path === profile) return json(specialist({ session_format: "online" }));
    if (path === slots) return slotList(taken ? [anotherSlot] : [firstSlot, anotherSlot], today);
    if (path === "/public/bookings" && request.method === "POST") {
      taken = true;
      return json({ code: "slot_taken" }, 409);
    }
    throw new Error("Unexpected request " + path);
  });
  const view = render(at(base, <PublicPage />));
  await openSlot(view);
  expect(screen.queryByRole("button", { name: t("profile.format_online") })).toBeNull();
  fill(t("form.name"), "Booking guest");
  fill(t("form.email"), guestEmail);
  fill("Comment", "Please preserve this");
  await acceptConsent();
  fireEvent.click(button("form.book"));
  await waitFor(() => expect(navigation.replace).toHaveBeenLastCalledWith(base));

  view.rerender(at(base, <PublicPage />));
  const takenDialog = within(await screen.findByRole("dialog", { name: t("form.slot_taken") }));
  fireEvent.click(takenDialog.getByRole("button", { name: t("extra.close") }));
  await openSlot(view, "15:00");
  expect(screen.getByRole("textbox", { name: t("form.name") })).toHaveProperty(
    "value",
    "Booking guest",
  );
  expect(screen.getByRole("textbox", { name: t("form.email") })).toHaveProperty(
    "value",
    guestEmail,
  );
  expect(screen.getByRole("textbox", { name: "Comment" })).toHaveProperty(
    "value",
    "Please preserve this",
  );
  await waitFor(() => expect(button("form.book")).toHaveProperty("disabled", false));
  expect(calls(requests, "/public/bookings", "POST")).toHaveLength(1);
  expect(calls(requests, slots)).toHaveLength(2);
});

// spec:test guest-booking-flow#refuse-booking-self-booking-entered
// spec:test guest-booking-flow#show-screen-9-4-character-text
// spec:test guest-booking-flow#show-screen-9-4-email-matches
test("shows the self-booking refusal inline and opens the contact screen for booking unavailable", async () => {
  const requests = publicApi((request, path) => {
    if (path === profile) return json(specialist({ session_format: "online" }));
    if (path === slots) return slotList([firstSlot], today);
    if (path === "/public/bookings" && request.method === "POST") {
      return request
        .json()
        .then((body: Schemas["GuestBookingCreate"]) =>
          json(
            { code: body.email === "leader@example.test" ? "self_booking" : "booking_unavailable" },
            409,
          ),
        );
    }
    throw new Error("Unexpected request " + path);
  });
  const view = render(at(base, <PublicPage />));
  await openSlot(view);
  fill(t("form.name"), "Booking guest");
  fill(t("form.email"), "leader@example.test");
  await acceptConsent();
  fireEvent.click(button("form.book"));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", t("c.self_booking"));
  expect(navigation.replace).not.toHaveBeenCalled();
  fill(t("form.email"), guestEmail);
  fireEvent.click(button("form.book"));
  await waitFor(() => expect(navigation.replace).toHaveBeenLastCalledWith(base + "/unavailable"));
  view.rerender(at(base + "/unavailable", <UnavailablePage />));
  expect(
    await screen.findByRole("heading", { name: t("unavailable.text", { name: "Ada Lovelace" }) }),
  ).toBeTruthy();
  expect(screen.getByRole("link", { name: t("card.telegram") }).getAttribute("href")).toBe(
    "https://t.me/ada_coach",
  );
  expect(screen.getByRole("main").querySelector("img")?.getAttribute("src")).toContain(
    "master-red",
  );
  expect(calls(requests, "/public/bookings", "POST")).toHaveLength(2);
});

test.each(["before form reload", "while submitting"])(
  "discards prior personal fields when a login changes owners %s",
  async (phase) => {
    let bookingContext = context;
    const requests = publicApi((request, path) => {
      if (path === profile)
        return json(
          specialist({
            booking_context: bookingContext,
            first_name: bookingContext === context ? "Ada" : "New",
            session_format: "online",
          }),
        );
      if (path === slots) return slotList([firstSlot], today);
      if (path === "/public/bookings" && request.method === "POST") {
        bookingContext = "only-the-new-owner";
        return json({ code: "conflict" }, 409);
      }
      throw new Error("Unexpected request " + path);
    });
    let view = render(at(base, <PublicPage />));
    await openSlot(view);
    fill(t("form.name"), "Prior private name");
    fill(t("form.email"), guestEmail);
    fill("Comment", "Prior private comment");
    await acceptConsent();
    if (phase === "before form reload") {
      bookingContext = "only-the-new-owner";
      view.unmount();
      view = render(at(base + "/book", <BookPage />));
    } else {
      fireEvent.click(button("form.book"));
    }
    await waitFor(() => expect(navigation.replace.mock.calls).toEqual([[base]]));
    const posted = calls(requests, "/public/bookings", "POST");
    expect(posted).toHaveLength(phase === "before form reload" ? 0 : 1);
    if (posted[0]) {
      expect(await posted[0].json()).toMatchObject({
        booking_context: context,
        name: "Prior private name",
      });
    }
    view.rerender(at(base, <PublicPage />));
    expect(await screen.findByRole("heading", { name: "New Lovelace" })).toBeTruthy();
    await openSlot(view);
    expect(screen.getByRole("textbox", { name: t("form.name") })).toHaveProperty("value", "");
    expect(screen.getByRole("textbox", { name: t("form.email") })).toHaveProperty("value", "");
    expect(screen.getByRole("textbox", { name: "Comment" })).toHaveProperty("value", "");
    expect(screen.getByRole("checkbox", { name: t("signup.terms") })).toHaveProperty(
      "checked",
      false,
    );
  },
);

// spec:test meeting-invite-page#open-screen-9-11-domain-login
// spec:test meeting-invite-page#show-character-title-leader-name
// spec:test meeting-invite-page#show-join-opening-meeting-call
// spec:test meeting-invite-page#show-add-calendar-offering-save-device
// spec:test meeting-invite-page#show-block-signup-title-signup-hint
// spec:test meeting-invite-page#start-sign-in-registration-entered-email
// spec:test meeting-invite-page#show-page-client-name-card
// spec:test meeting-invite-page#write-anything-database-page-opened
test.each(["registration_required", "code_sent"] as const)(
  "checks the public invite before handing off %s and never exposes client data",
  async (outcome) => {
    const download = calendarDownload();
    const requests = publicApi((_request, path) => {
      if (path === invitePath)
        return json({
          ...invite(),
          client_name: "Hidden client",
          price: "9999",
          comment: "Confidential comment",
        });
      if (path === invitePath + "/calendar.ics")
        return new Response("BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n", {
          headers: { "Content-Type": "text/calendar" },
        });
      if (path === invitePath + "/join")
        return json({
          outcome,
          first_name: outcome === "code_sent" ? "Current" : null,
        } satisfies Schemas["SignInCodeRequestResult"]);
      throw new Error("Unexpected request " + path);
    });
    oldRegistration({ page: "public_booking", login, meeting_id: null });
    saveIntent("lead");
    render(at(base + "/meet/" + inviteId, <InvitePage />));
    expect(
      await screen.findByRole("heading", { name: t("meet.title", { name: "Ada Lovelace" }) }),
    ).toBeTruthy();
    expect(screen.getByText("AL")).toBeTruthy();
    expect(screen.getByText(t("extra.profile_coach"))).toBeTruthy();
    expect(screen.getByText("26 November · 14:00")).toBeTruthy();
    expect(screen.getByText("60 minutes · Online")).toBeTruthy();
    expect(screen.getByText(t("public.tz_label", { city: "Belgrade", "±N": "+1" }))).toBeTruthy();
    expect(screen.getByRole("link", { name: t("meet.join") }).getAttribute("href")).toBe(callUrl);
    expect(screen.queryByText(/Hidden client|9999|Confidential comment/u)).toBeNull();
    expect(screen.getByRole("heading", { name: t("meet.signup_title") })).toBeTruthy();
    expect(screen.getByText(t("meet.signup_hint"))).toBeTruthy();
    fireEvent.click(button("meet.add_calendar"));
    await waitFor(() => expect(download).toHaveBeenCalledTimes(1));
    const calendar = calls(requests, invitePath + "/calendar.ics")[0];
    expect(calendar?.url).toBe(api + "/api/v1" + invitePath + "/calendar.ics?language=en");

    const submit = button("meet.signup_button");
    expect(submit).toHaveProperty("disabled", true);
    fill(t("form.email"), "not-email");
    expect(submit).toHaveProperty("disabled", true);
    fill(t("form.email"), "Guest@Example.Test");
    expect(submit).toHaveProperty("disabled", false);
    expect(requests.every((request) => request.method === "GET")).toBe(true);
    fireEvent.click(submit);
    const expected = outcome === "code_sent" ? "/login/code" : "/register";
    await waitFor(() => expect(navigation.push).toHaveBeenCalledExactlyOnceWith(expected));
    expect(await calls(requests, invitePath + "/join", "POST")[0]?.json()).toEqual({
      email: guestEmail,
      language: "en",
    });
    expect(loadPackage()).toBeNull();
    const origin = { page: "meeting_invite", login, meeting_id: inviteId };
    expect(loadOrigin()).toEqual(origin);
    expect(loadIntent()).toBeNull();
    if (outcome === "code_sent") {
      expect(loadCode()).toMatchObject({ email: guestEmail, firstName: "Current", origin });
    } else {
      expect(loadSignupEmail()).toBe(guestEmail);
      expect(loadCode()).toBeNull();
    }
  },
);

// spec:test meeting-invite-page#show-in-person-meeting-address
// spec:test meeting-invite-page#show-not-found-page-character-link
test("shows the in-person address and offers a home link if the invitation disappears", async () => {
  calendarDownload();
  publicApi((_request, path) => {
    if (path === invitePath)
      return json(
        invite({
          place: "in_person",
          meeting_link: null,
          address: "12 Public Square, Belgrade",
        }),
      );
    if (path === invitePath + "/calendar.ics") return json({ code: "not_found" }, 404);
    throw new Error("Unexpected request " + path);
  });
  render(at(base + "/meet/" + inviteId, <InvitePage />));
  expect(await screen.findByText(/12 Public Square, Belgrade/u)).toBeTruthy();
  expect(screen.getByText("60 minutes · In person")).toBeTruthy();
  expect(screen.queryByRole("link", { name: t("meet.join") })).toBeNull();
  await act(async () => fireEvent.click(button("meet.add_calendar")));
  expect(await screen.findByRole("heading", { name: t("meet.not_found") })).toBeTruthy();
  expect(screen.getByRole("link", { name: t("extra.celmento_site") }).getAttribute("href")).toBe(
    "/",
  );
  expect(screen.getByRole("main").querySelector("img")?.getAttribute("src")).toContain(
    "master-blue",
  );
});

test.each(["different email", "different origin"])(
  "lets a booking email link take priority over a pending signup with %s",
  async (difference) => {
    const correctOrigin = { page: "public_booking", login, meeting_id: null } as const;
    const previousOrigin: Schemas["RegistrationOrigin"] =
      difference === "different email"
        ? correctOrigin
        : { page: "meeting_invite", login, meeting_id: inviteId };
    const recipient = difference === "different email" ? "new-guest@example.test" : guestEmail;
    oldRegistration(previousOrigin);
    const query = new URLSearchParams({
      email: recipient.toUpperCase(),
      origin: JSON.stringify(correctOrigin),
    });
    window.history.replaceState(null, "", "/login?" + query);
    const requests = publicApi((_request, path) => {
      if (path === "/auth/code/request")
        return json({ outcome: "registration_required", first_name: null });
      throw new Error("Unexpected request " + path);
    });
    render(
      <AuthLayout>
        <Login />
      </AuthLayout>,
    );
    expect(await screen.findByRole("textbox", { name: t("login.email") })).toHaveProperty(
      "value",
      recipient,
    );
    expect(window.location.search).toBe("");
    expect(navigation.replace).not.toHaveBeenCalled();
    expect(loadPackage()).toBeNull();
    expect(loadCode()).toBeNull();
    expect(loadOrigin()).toEqual(correctOrigin);
    fireEvent.click(button("login.title"));
    await waitFor(() => expect(navigation.push).toHaveBeenLastCalledWith("/register"));
    expect(await calls(requests, "/auth/code/request", "POST")[0]?.json()).toEqual({
      email: recipient,
      language: "en",
    });
  },
);

test.each([false, true])(
  "resumes a valid saved signup from a plain or matching login (explicit: %s)",
  async (explicit) => {
    const origin = { page: "public_booking", login, meeting_id: null } as const;
    oldRegistration(origin);
    const query = explicit
      ? "?" + new URLSearchParams({ email: guestEmail, origin: JSON.stringify(origin) })
      : "";
    window.history.replaceState(null, "", "/login" + query);
    render(
      <AuthLayout>
        <Login />
      </AuthLayout>,
    );
    await waitFor(() =>
      expect(navigation.replace).toHaveBeenCalledExactlyOnceWith("/register/finish"),
    );
    expect(loadPackage()?.claims.origin).toEqual(origin);
  },
);
