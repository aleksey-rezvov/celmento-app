import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { AppNavigationProvider } from "@/components/shell/navigation";
import { AccountProvider } from "@/lib/account";
import type { Schemas } from "@/lib/api/client";
import { t } from "@/lib/i18n/messages";
import { getSessionToken, setSessionToken } from "@/lib/session";
import ActivatePage from "./activate/page";
import FeedbackPage from "./feedback/page";
import LoginPage from "./login/page";
import ProfilePage from "./page";
import SchedulePage from "./schedule/page";

const navigation = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => navigation }));

type Account = Schemas["Account"];
type Leader = Schemas["LeaderProfile"];
type Update = Schemas["AccountUpdate"];

const apiOrigin = "https://application-api.example.test";
const address = "https://celmento.com/adalovelace";
const email = "ada@example.com";
const session = "profile-test-session";
const now = "2026-11-25T13:00:00Z";
const weekdays: readonly Schemas["Weekday"][] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const leaderProfile: Leader = {
  specializations: [],
  specialization_other: null,
  about: "",
  contact_email: email,
  links: [],
  main_channel: null,
  booking_url: address,
  working_hours: weekdays.map((weekday, index) => ({
    weekday,
    working: index < 5,
    start: "10:00",
    end: "18:00",
  })),
  session_duration_minutes: 60,
  session_format: "online",
  default_meeting_link: null,
  default_rate: null,
  default_currency: "RUB",
  plan: { kind: "free", client_limit: 3, active_clients: 0, subscription_until: null },
};

function account(leader: Leader | null = null): Account {
  return {
    id: "019ac0dd-ce00-7ef1-a710-54e13cd9849e",
    contour: "world",
    email,
    first_name: "Ada",
    last_name: "Lovelace",
    photo_url: null,
    phone: null,
    telegram: null,
    whatsapp: null,
    login: "adalovelace",
    address_url: address,
    language: "en",
    time_zone: "UTC",
    activated: leader !== null,
    activated_at: leader ? now : null,
    leader,
    acceptances: [],
    created_at: now,
  };
}

function json(content: unknown): Response {
  return new Response(JSON.stringify(content), {
    headers: { "Content-Type": "application/json" },
  });
}

const titles = {
  terms_of_use: "Terms of Use",
  privacy_policy: "Privacy Policy",
  specialist_offer: "Specialist offer",
  data_processing_instruction: "Data processing instruction",
} as const;

function setupApi(initial: Account = account()): Request[] {
  const requests: Request[] = [];
  let stored = initial;

  vi.stubGlobal(
    "fetch",
    vi.fn(async (request: Request): Promise<Response> => {
      requests.push(request.clone());
      const url = new URL(request.url);
      const path = url.pathname.replace(/^\/api\/v1/u, "");
      if (request.method === "GET" && path === "/account") return json(stored);
      if (request.method === "GET" && path === "/notices") return json({ items: [] });
      if (request.method === "PATCH" && path === "/account") {
        const { leader, ...fields }: Update = await request.json();
        stored = { ...stored, ...fields };
        if (leader && stored.leader) stored.leader = { ...stored.leader, ...leader };
        if (fields.login) {
          stored.login = fields.login.toLowerCase();
          stored.address_url = "https://celmento.com/" + stored.login;
          if (stored.leader) stored.leader.booking_url = stored.address_url;
        }
        return json(stored);
      }

      if (request.method === "POST" && path === "/account/activation") {
        stored = { ...stored, activated: true, activated_at: now, leader: leaderProfile };
        return json(stored);
      }

      if (request.method === "GET" && path === "/account/login-availability") {
        const login = url.searchParams.get("login") ?? "";
        const status: Schemas["LoginAvailabilityStatus"] =
          login.length < 5
            ? "rule_length"
            : login.toLowerCase() === "admin"
              ? "reserved"
              : login.toLowerCase() === "another_user"
                ? "taken"
                : "available";
        return json({ login: login.toLowerCase(), status });
      }

      if (path.startsWith("/documents/")) {
        const kind = Object.keys(titles).find((name) => path === "/documents/" + name);
        if (!kind) throw new Error("Unexpected document request.");
        const title = titles[kind as keyof typeof titles];
        return json({
          kind,
          version: "world-test-v2",
          contour: stored.contour,
          language: url.searchParams.get("language"),
          title,
          text: "The current document.",
        });
      }

      if (request.method === "PUT" && path === "/account/photo") {
        stored = { ...stored, photo_url: apiOrigin + "/media/profile.png" };
        return json(stored);
      }
      if (request.method === "DELETE" && path === "/account/photo") {
        stored = { ...stored, photo_url: null };
        return json(stored);
      }
      if (request.method === "POST" && ["/feedback", "/auth/sign-out"].includes(path)) {
        return new Response(null, { status: 204 });
      }
      throw new Error("Unexpected profile request: " + request.method + " " + path);
    }),
  );

  return requests;
}

function requestFor(requests: Request[], method: string, pathname: string): Request | undefined {
  return requests.find(
    (request) =>
      request.method === method && new URL(request.url).pathname === "/api/v1" + pathname,
  );
}

function providers(page: ReactElement): ReactElement {
  return (
    <AccountProvider>
      <AppNavigationProvider>{page}</AppNavigationProvider>
    </AccountProvider>
  );
}

function changeText(name: string, value: string): void {
  fireEvent.change(screen.getByRole("textbox", { name }), { target: { value } });
}

function profileSection(name: string): HTMLElement {
  const section = screen.getByRole("heading", { name }).closest("section");
  if (!section) throw new Error("Profile section not found.");
  return section;
}

async function openProfile(): Promise<void> {
  await screen.findByRole("heading", { name: t("profile.title") });
}

function edit(): void {
  fireEvent.click(screen.getByRole("button", { name: t("card.edit") }));
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
  vi.stubEnv("NEXT_PUBLIC_CLM_APP_API_URL", apiOrigin);
  vi.stubEnv("NEXT_PUBLIC_CLM_APP_CONTOUR", "world");
  setSessionToken(session);
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  document.documentElement.lang = "en";
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

// spec:test account-profile#show-header-photo-initials-first
// spec:test account-profile#show-client-name-hint-name-field
// spec:test account-profile#show-account-leader-not-block
// spec:test account-profile#show-account-sign-in-email-login-email
// spec:test account-profile#let-sign-in-email-region-changed
// spec:test client-leading-activation#hide-non-leader-profile-sections-booking
test("shows the attendee's identity, address, settings and read-only region and email", async () => {
  setupApi();
  const view = render(providers(<ProfilePage />));
  await openProfile();

  expect(screen.getByRole("heading", { name: "Ada Lovelace" })).toBeTruthy();
  expect(view.container.querySelector(".profile-avatar")?.textContent).toBe("AL");
  expect(screen.getByText(t("profile.client_name_hint"))).toBeTruthy();
  const sharedAddress = within(profileSection(t("profile.client_login")));
  expect(sharedAddress.getByText("celmento.com/")).toBeTruthy();
  expect(sharedAddress.getByText("adalovelace")).toBeTruthy();
  expect(sharedAddress.getByText(t("profile.client_login_hint"))).toBeTruthy();
  expect(sharedAddress.getByRole("button", { name: t("profile.link_copy") })).toBeTruthy();

  const details = within(profileSection(t("profile.account")));
  expect(details.getByText(email)).toBeTruthy();
  expect(details.getByText(t("finish.region_world"))).toBeTruthy();
  expect(details.getByText(t("profile.region_hint_world"))).toBeTruthy();
  expect(details.getByRole("button", { name: t("profile.logout") })).toBeTruthy();
  expect(details.queryByRole("textbox")).toBeNull();
  for (const key of [
    "profile.about",
    "profile.link_section",
    "profile.schedule",
    "profile.price",
    "profile.plan",
  ] as const) {
    expect(screen.queryByText(t(key))).toBeNull();
  }
  expect(screen.getByRole("button", { name: t("start.lead") })).toBeTruthy();
});

// spec:test account-profile#switch-edit-mode-pencil-button
// spec:test account-profile#prefill-first-last-name-registration
test("opens prefilled name fields, refuses blanks or names past the limit and saves only changed fields", async () => {
  const requests = setupApi();
  render(providers(<ProfilePage />));
  await openProfile();

  expect(screen.queryByRole("textbox", { name: t("signup.first_name") })).toBeNull();
  edit();
  const first = screen.getByRole("textbox", { name: t("signup.first_name") });
  const last = screen.getByRole("textbox", { name: t("signup.last_name") });
  const save = screen.getByRole("button", { name: t("profile.save") });
  expect(first).toHaveProperty("value", "Ada");
  expect(last).toHaveProperty("value", "Lovelace");
  expect(first).toHaveProperty("maxLength", 100);
  expect(last).toHaveProperty("maxLength", 100);
  changeText(t("signup.first_name"), " ");
  expect(save).toHaveProperty("disabled", true);
  changeText(t("signup.first_name"), "X".repeat(101));
  expect(save).toHaveProperty("disabled", true);
  changeText(t("signup.first_name"), "Augusta");
  changeText(t("signup.last_name"), "");
  expect(save).toHaveProperty("disabled", true);
  changeText(t("signup.last_name"), "Lovelace");
  expect(save).toHaveProperty("disabled", false);
  fireEvent.click(save);

  await screen.findByRole("heading", { name: "Augusta Lovelace" });
  await waitFor(() =>
    expect(screen.queryByRole("textbox", { name: t("signup.first_name") })).toBeNull(),
  );
  expect(await requestFor(requests, "PATCH", "/account")?.json()).toEqual({
    first_name: "Augusta",
  });
  expect(requestFor(requests, "PATCH", "/account")?.headers.get("Authorization")).toBe(
    "Bearer " + session,
  );
});

// spec:test account-profile#ask-unsaved-save-dont-save-account
test("offers save or discard on in-app navigation, preserving the destination", async () => {
  const requests = setupApi();
  render(providers(<ProfilePage />));
  await openProfile();

  edit();
  changeText(t("signup.first_name"), "Augusta");
  fireEvent.click(screen.getByRole("button", { name: t("profile.feedback") }));
  const confirm = within(screen.getByRole("dialog", { name: t("profile.unsaved") }));
  expect(navigation.push).not.toHaveBeenCalled();
  fireEvent.click(confirm.getByRole("button", { name: t("profile.save") }));
  await waitFor(() => expect(navigation.push).toHaveBeenCalledWith("/app/profile/feedback"));
  expect(await requestFor(requests, "PATCH", "/account")?.json()).toEqual({
    first_name: "Augusta",
  });

  edit();
  changeText(t("signup.last_name"), "Byron");
  fireEvent.click(screen.getByRole("button", { name: t("start.lead") }));
  const discard = within(screen.getByRole("dialog", { name: t("profile.unsaved") }));
  expect(navigation.push).toHaveBeenCalledTimes(1);
  fireEvent.click(discard.getByRole("button", { name: t("profile.dont_save") }));
  expect(navigation.push).toHaveBeenLastCalledWith("/app/profile/activate");
  expect(screen.getByRole("heading", { name: "Augusta Lovelace" })).toBeTruthy();
  expect(requests.filter(({ method }) => method === "PATCH")).toHaveLength(1);
});

// spec:test account-profile#show-profile-tab-one-scrollable
// spec:test account-profile#show-about-link-section-schedule-price
// spec:test account-profile#show-contacts-fields-phone-telegram
// spec:test account-profile#offer-about-field-specialization
// spec:test account-profile#limit-about-text-1000-characters-show
// spec:test account-profile#show-price-section-price-currency
// spec:test client-leading-activation#show-profile-lead-button-leader
// spec:test default-rate-currency#show-price-section-profile-screen
// spec:test default-rate-currency#show-defaults-hint-price-fields-edit
test("groups leader sections in reading order and edits profile defaults without requiring a rate", async () => {
  const requests = setupApi(account(leaderProfile));
  render(providers(<ProfilePage />));
  await openProfile();
  expect(screen.queryByRole("button", { name: t("start.lead") })).toBeNull();

  const ordered = [
    screen.getByRole("heading", { name: "Ada Lovelace" }),
    profileSection(t("profile.about")),
    profileSection(t("profile.contacts")),
    profileSection(t("profile.client_login")),
    profileSection(t("profile.link_section")),
    screen.getByRole("button", { name: t("profile.schedule") }),
    profileSection(t("profile.price")),
    profileSection(t("profile.plan")),
    profileSection(t("profile.settings")),
    profileSection(t("profile.help")),
    profileSection(t("profile.account")),
  ];
  for (const [index, section] of ordered.entries()) {
    const previous = ordered[index - 1];
    if (previous) {
      expect(previous.compareDocumentPosition(section)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    }
  }

  edit();
  const contact = within(profileSection(t("profile.contacts")));
  for (const key of ["profile.phone", "card.telegram", "card.whatsapp"] as const) {
    expect(contact.getByRole("textbox", { name: t(key) })).toBeTruthy();
  }
  expect(contact.getByRole("textbox", { name: t("profile.contact_email") })).toHaveProperty(
    "value",
    email,
  );
  const addLink = contact.getByRole("button", { name: t("extra.profile_add_link") });
  for (let index = 0; index < 5; index += 1) fireEvent.click(addLink);
  expect(contact.queryByRole("button", { name: t("extra.profile_add_link") })).toBeNull();
  expect(contact.getAllByRole("textbox", { name: /^Link \d$/u })).toHaveLength(5);
  expect(contact.getByRole("combobox", { name: t("profile.main_channel") })).toHaveProperty(
    "value",
    "",
  );
  fireEvent.change(contact.getByRole("combobox", { name: t("profile.main_channel") }), {
    target: { value: "email" },
  });
  changeText(t("profile.contact_email"), "");
  expect(contact.getByRole("combobox", { name: t("profile.main_channel") })).toHaveProperty(
    "value",
    "",
  );

  const about = within(profileSection(t("profile.about")));
  const options = about.getByRole("group", { name: t("profile.specialization") });
  expect(within(options).getAllByRole("button")).toHaveLength(7);
  fireEvent.click(within(options).getByRole("button", { name: t("extra.profile_coach") }));
  fireEvent.click(within(options).getByRole("button", { name: t("extra.profile_other") }));
  changeText(t("extra.profile_other"), "Facilitator");
  const bio = about.getByRole("textbox", { name: t("profile.about_text") });
  expect(bio).toHaveProperty("maxLength", 1000);
  fireEvent.change(bio, { target: { value: "A new bio" } });
  expect(about.getByText("9 / 1000")).toBeTruthy();

  const price = within(profileSection(t("profile.price")));
  const rate = price.getByRole("textbox", { name: t("profile.price") });
  const currency = within(price.getByRole("group", { name: t("profile.currency") }));
  expect(rate).toHaveProperty("value", "");
  expect(currency.getAllByRole("button").map((button) => button.textContent)).toEqual([
    "RUB (₽)",
    "EUR (€)",
    "USD ($)",
  ]);
  expect(currency.getByRole("button", { name: "RUB (₽)" }).getAttribute("aria-pressed")).toBe(
    "true",
  );
  fireEvent.click(currency.getByRole("button", { name: "EUR (€)" }));
  expect(price.getByText(t("profile.defaults_hint"))).toBeTruthy();
  const save = screen.getByRole("button", { name: t("profile.save") });
  fireEvent.change(rate, { target: { value: "-1" } });
  expect(save).toHaveProperty("disabled", true);
  fireEvent.change(rate, { target: { value: "" } });
  expect(save).toHaveProperty("disabled", false);
  fireEvent.click(save);

  await waitFor(() => expect(screen.queryByRole("button", { name: t("profile.save") })).toBeNull());
  expect(await requestFor(requests, "PATCH", "/account")?.json()).toEqual({
    leader: {
      specializations: ["coach", "other"],
      specialization_other: "Facilitator",
      about: "A new bio",
      contact_email: null,
      links: [],
      default_rate: null,
      default_currency: "EUR",
    },
  });
  expect(screen.getByText("Coach, Facilitator")).toBeTruthy();
});

// spec:test account-profile#let-account-add-photo-gallery
test("centre-crops a gallery image to a circle and refreshes the avatar after upload and removal", async () => {
  const requests = setupApi();
  const forms: FormData[] = [];
  class UploadRequest extends Request {
    constructor(input: RequestInfo | URL, init?: RequestInit) {
      super(input, init);
      if (init?.body instanceof FormData) forms.push(init.body);
    }
  }
  vi.stubGlobal("Request", UploadRequest);
  const bitmap = { width: 800, height: 400, close: vi.fn() };
  const canvas = { beginPath: vi.fn(), arc: vi.fn(), clip: vi.fn(), drawImage: vi.fn() };
  vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue(bitmap));
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    canvas as unknown as CanvasRenderingContext2D,
  );
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) =>
    callback(new Blob(["cropped"], { type: "image/png" })),
  );
  class PreviewURL extends URL {
    static createObjectURL(): string {
      return "blob:profile-photo";
    }

    static revokeObjectURL(): void {}
  }
  vi.stubGlobal("URL", PreviewURL);

  const view = render(providers(<ProfilePage />));
  await openProfile();
  edit();
  const gallery = screen.getByLabelText(t("extra.profile_edit_photo"));
  expect(gallery.getAttribute("accept")).toBe("image/jpeg,image/png,image/webp");
  expect(screen.getByLabelText(t("extra.profile_camera")).getAttribute("capture")).toBe("user");
  fireEvent.change(gallery, {
    target: { files: [new File(["raw"], "portrait.jpg", { type: "image/jpeg" })] },
  });

  await waitFor(() =>
    expect(view.container.querySelector(".profile-avatar img")?.getAttribute("src")).toBe(
      "blob:profile-photo",
    ),
  );
  expect(canvas.arc).toHaveBeenCalledWith(256, 256, 256, 0, 2 * Math.PI);
  expect(canvas.clip).toHaveBeenCalledOnce();
  expect(canvas.drawImage).toHaveBeenCalledWith(bitmap, 200, 0, 400, 400, 0, 0, 512, 512);
  expect(bitmap.close).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: t("profile.save") }));

  await waitFor(() => {
    expect(view.container.querySelector(".profile-avatar img")?.getAttribute("src")).toBe(
      apiOrigin + "/media/profile.png",
    );
  });
  const upload = requestFor(requests, "PUT", "/account/photo");
  const boundary = upload?.headers.get("Content-Type")?.split("boundary=")[1];
  if (!upload || !boundary) throw new Error("The photo request needs a multipart boundary.");
  expect(upload.headers.get("Content-Type")).toContain("multipart/form-data");
  const cropped = forms[0]?.get("file");
  if (!(cropped instanceof File)) throw new Error("The photo request needs a cropped image.");
  expect(cropped.name).toBe("profile.png");
  expect(cropped.type).toBe("image/png");
  const pixels = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(cropped);
  });
  expect(pixels).toBe("cropped");
  edit();
  fireEvent.click(screen.getByRole("button", { name: t("extra.profile_remove_photo") }));
  fireEvent.click(screen.getByRole("button", { name: t("profile.save") }));
  await waitFor(() => expect(requestFor(requests, "DELETE", "/account/photo")).toBeDefined());
  await waitFor(() => expect(screen.queryByRole("button", { name: t("profile.save") })).toBeNull());
  expect(view.container.querySelector(".profile-avatar")?.textContent).toBe("AL");
});

// spec:test account-profile#show-link-section-booking-link-link-copy
// spec:test booking-link-login#copy-address-domain-login-clipboard
// spec:test booking-link-login#open-system-share-sheet-link-share
test("copies both profile addresses and invokes the system share sheet with the booking link", async () => {
  setupApi(account(leaderProfile));
  const writeText = vi.fn().mockResolvedValue(undefined);
  const share = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", {
    userAgent: "Test browser",
    language: "en",
    clipboard: { writeText },
    share,
  });
  render(providers(<ProfilePage />));
  await openProfile();

  for (const label of ["profile.client_login", "profile.link_section"] as const) {
    const section = within(profileSection(t(label)));
    fireEvent.click(section.getByRole("button", { name: t("profile.link_copy") }));
    expect(await section.findByRole("status")).toHaveProperty(
      "textContent",
      t("profile.link_copied"),
    );
  }
  expect(writeText.mock.calls).toEqual([[address], [address]]);
  const booking = within(profileSection(t("profile.link_section")));
  fireEvent.click(booking.getByRole("button", { name: t("profile.link_share") }));
  expect(share).toHaveBeenCalledWith({ text: t("profile.link_share_text", { link: address }) });
});

// spec:test account-profile#show-settings-language-setting-timezone
// spec:test interface-language#show-language-setting-language-options
// spec:test interface-language#apply-language-change-screen-immediately
// spec:test time-zone-handling#show-time-zone-setting-timezone
test("saves language immediately and selects a time zone by localized city and offset", async () => {
  const requests = setupApi();
  render(providers(<ProfilePage />));
  await openProfile();

  const languages = within(screen.getByRole("group", { name: t("profile.language") }));
  expect(languages.getAllByRole("button").map((button) => button.textContent)).toEqual([
    "RU",
    "EN",
  ]);
  expect(languages.getByRole("button", { name: "EN" }).getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(languages.getByRole("button", { name: "RU" }));
  expect(
    await screen.findByRole("heading", { name: t("profile.title", undefined, "ru") }),
  ).toBeTruthy();
  expect(document.documentElement.lang).toBe("ru");
  expect(screen.getByRole("heading", { name: "Ada Lovelace" })).toBeTruthy();
  expect(getSessionToken()).toBe(session);

  const label = t("profile.timezone", undefined, "ru");
  fireEvent.click(screen.getByRole("button", { name: new RegExp(label, "u") }));
  const choices = within(screen.getByRole("dialog", { name: label }));
  fireEvent.change(
    choices.getByRole("searchbox", { name: t("extra.profile_city_search", undefined, "ru") }),
    {
      target: { value: "Белград" },
    },
  );
  const city = choices.getByRole("button", { name: /^Белград \(UTC[+-]\d+\)$/u });
  expect(choices.getAllByRole("listitem")).toHaveLength(1);
  fireEvent.click(city);
  await waitFor(() => expect(screen.queryByRole("dialog", { name: label })).toBeNull());
  expect(screen.getByRole("button", { name: /Часовой пояс Белград \(UTC[+-]\d+\)/u })).toBeTruthy();
  const changes = requests.filter(({ method }) => method === "PATCH");
  expect(await Promise.all(changes.map((request) => request.json()))).toEqual([
    { language: "ru" },
    { time_zone: "Europe/Belgrade" },
  ]);
  expect(navigation.push).not.toHaveBeenCalled();
  expect(navigation.replace).not.toHaveBeenCalled();
});

// spec:test account-profile#start-activation-client-leading-activation
// spec:test client-leading-activation#open-profile-lead-button-confirmation
// spec:test client-leading-activation#combine-18-confirmation-document
test("requires two unchecked activation choices and updates Profile from the returned account", async () => {
  const requests = setupApi();
  const view = render(providers(<ProfilePage />));
  await openProfile();
  fireEvent.click(screen.getByRole("button", { name: t("start.lead") }));
  expect(navigation.push).toHaveBeenCalledWith("/app/profile/activate");
  view.rerender(providers(<ActivatePage />));

  const choices = screen.getAllByRole("checkbox");
  expect(choices).toHaveLength(2);
  const [age, terms] = choices;
  if (!age || !terms) throw new Error("Both activation checkboxes are required.");
  const confirm = screen.getByRole("button", { name: t("extra.profile_activate") });
  expect(age).toHaveProperty("checked", false);
  expect(terms).toHaveProperty("checked", false);
  expect(confirm).toHaveProperty("disabled", true);
  fireEvent.click(age);
  expect(confirm).toHaveProperty("disabled", true);

  fireEvent.click(screen.getByRole("button", { name: t("extra.auth_specialist_terms_link") }));
  expect(await screen.findByRole("dialog", { name: "Specialist offer" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: t("extra.auth_close_document") }));
  expect(age).toHaveProperty("checked", true);
  expect(terms).toHaveProperty("checked", false);
  fireEvent.click(terms);
  await waitFor(() => expect(confirm).toHaveProperty("disabled", false));
  fireEvent.click(confirm);
  await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith("/app/profile"));

  const body = await requestFor(requests, "POST", "/account/activation")?.json();
  expect(body).toEqual({
    age_confirmed: true,
    acceptances: [
      { document: "specialist_offer", version: "world-test-v2", accepted_at: expect.any(String) },
      {
        document: "data_processing_instruction",
        version: "world-test-v2",
        accepted_at: expect.any(String),
      },
    ],
  });
  view.rerender(providers(<ProfilePage />));
  expect(await screen.findByRole("heading", { name: t("profile.about") })).toBeTruthy();
  expect(screen.queryByRole("button", { name: t("start.lead") })).toBeNull();
  expect(
    requests.filter(
      (request) => request.method === "GET" && new URL(request.url).pathname.endsWith("/account"),
    ),
  ).toHaveLength(1);
  expect(getSessionToken()).toBe(session);
});

// spec:test account-profile#open-screen-2-3-schedule
// spec:test working-hours-booking-rules#open-screen-2-3-schedule-section
// spec:test working-hours-booking-rules#show-screen-2-3-7-days
// spec:test working-hours-booking-rules#allow-one-interval-day-start
// spec:test working-hours-booking-rules#block-save-show
test("edits the seven working intervals in quarter hours and saves an all-days-off schedule", async () => {
  const leader = { ...leaderProfile, default_meeting_link: "https://call.example.test/ada" };
  const requests = setupApi(account(leader));
  const view = render(providers(<ProfilePage />));
  await openProfile();
  fireEvent.click(screen.getByRole("button", { name: t("profile.schedule") }));
  expect(navigation.push).toHaveBeenCalledWith("/app/profile/schedule");
  view.rerender(providers(<SchedulePage />));

  const monday = within(screen.getByRole("group", { name: /^Monday$/iu }));
  const start = monday.getByRole("combobox", { name: t("extra.profile_work_start") });
  const end = monday.getByRole("combobox", { name: t("extra.profile_work_end") });
  expect(screen.getAllByRole("switch")).toHaveLength(7);
  expect(start).toHaveProperty("value", "10:00");
  expect(end).toHaveProperty("value", "18:00");
  expect(within(start).getAllByRole("option")).toHaveLength(96);
  expect(within(start).queryByRole("option", { name: "10:07" })).toBeNull();
  expect(
    screen
      .getByRole("button", { name: t("public.duration", { N: 60 }) })
      .getAttribute("aria-pressed"),
  ).toBe("true");

  const save = screen.getByRole("button", { name: t("profile.save") });
  fireEvent.change(end, { target: { value: "09:45" } });
  expect(monday.getByRole("alert")).toHaveProperty("textContent", t("extra.profile_work_order"));
  expect(save).toHaveProperty("disabled", true);
  fireEvent.change(end, { target: { value: "18:00" } });
  expect(save).toHaveProperty("disabled", false);

  for (const toggle of screen.getAllByRole("switch")) {
    if (toggle instanceof HTMLInputElement && toggle.checked) fireEvent.click(toggle);
  }
  expect(screen.getByText(t("extra.profile_no_work_days"))).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: t("profile.format_offline") }));
  expect(screen.queryByRole("textbox", { name: t("profile.default_link") })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: t("extra.back") }));
  expect(navigation.push).toHaveBeenCalledTimes(1);
  fireEvent.click(
    within(screen.getByRole("dialog", { name: t("profile.unsaved") })).getByRole("button", {
      name: t("profile.save"),
    }),
  );
  await waitFor(() => expect(navigation.push).toHaveBeenLastCalledWith("/app/profile"));
  expect(await requestFor(requests, "PATCH", "/account")?.json()).toEqual({
    leader: {
      working_hours: leader.working_hours.map((day) => ({ ...day, working: false })),
      session_duration_minutes: 60,
      session_format: "in_person",
      default_meeting_link: "https://call.example.test/ada",
    },
  });
});

// spec:test booking-link-login#check-availability-typed-accounts
// spec:test booking-link-login#check-login-typed-show-field
// spec:test booking-link-login#show-login-hint-login-field
// spec:test booking-link-login#show-login-forbidden-login-equals
// spec:test booking-link-login#show-leader-login-change-warning-before
// spec:test booking-link-login#save-login-violates-rule-taken
test("checks each typed login, warns about the old booking link and refreshes the accepted address", async () => {
  const requests = setupApi(account(leaderProfile));
  const view = render(providers(<ProfilePage />));
  await openProfile();
  const link = within(profileSection(t("profile.link_section")));
  fireEvent.click(link.getByRole("button", { name: /celmento\.com/u }));
  expect(navigation.push).toHaveBeenCalledWith("/app/profile/login");
  view.rerender(providers(<LoginPage />));
  const label = t("profile.client_login");
  const save = screen.getByRole("button", { name: t("profile.save") });
  expect(screen.getByRole("textbox", { name: label })).toHaveProperty("value", "adalovelace");
  expect(screen.getByText(t("profile.login_hint"))).toBeTruthy();

  const rejected = [
    ["ad", "profile.login_rule_length"],
    ["ADMIN", "profile.login_forbidden"],
    ["Another_User", "profile.login_taken"],
  ] as const;
  for (const [login, hint] of rejected) {
    changeText(label, login);
    expect(await screen.findByText(t(hint))).toBeTruthy();
    expect(save).toHaveProperty("disabled", true);
  }
  changeText(label, "New_Ada");
  expect(save).toHaveProperty("disabled", true);
  expect(screen.getByText(t("profile.login_change_warning"))).toBeTruthy();
  expect(await screen.findByRole("img", { name: t("extra.auth_login_available") })).toBeTruthy();
  fireEvent.click(save);

  await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith("/app/profile"));
  expect(await requestFor(requests, "PATCH", "/account")?.json()).toEqual({ login: "New_Ada" });
  const checked = requests
    .map((request) => new URL(request.url))
    .filter((url) => url.pathname.endsWith("/account/login-availability"))
    .map((url) => url.searchParams.get("login"));
  expect(checked).toEqual(["ad", "ADMIN", "Another_User", "New_Ada"]);
  view.rerender(providers(<ProfilePage />));
  expect(within(profileSection(t("profile.client_login"))).getByText("new_ada")).toBeTruthy();
});

// spec:test account-profile#show-help-entries-terms-privacy
// spec:test legal-documents#list-terms-privacy-help-section
test("opens both Help documents in the account contour and returns to Profile", async () => {
  const requests = setupApi();
  render(providers(<ProfilePage />));
  await openProfile();
  const documents = [
    ["profile.terms", "terms_of_use", "Terms of Use"],
    ["profile.privacy", "privacy_policy", "Privacy Policy"],
  ] as const;
  for (const [key, kind, title] of documents) {
    const help = within(profileSection(t("profile.help")));
    fireEvent.click(help.getByRole("button", { name: t(key) }));
    const overlay = within(await screen.findByRole("dialog", { name: title }));
    expect(overlay.getByText("world-test-v2")).toBeTruthy();
    expect(overlay.getByText("The current document.")).toBeTruthy();
    const request = requestFor(requests, "GET", "/documents/" + kind);
    expect(request?.url).toBe(apiOrigin + "/api/v1/documents/" + kind + "?language=en");
    fireEvent.click(overlay.getByRole("button", { name: t("extra.auth_close_document") }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("heading", { name: t("profile.title") })).toBeTruthy();
  }
});

// spec:test product-feedback#show-feedback-entry-help-section
// spec:test product-feedback#open-screen-2-7-single-multi-line
// spec:test product-feedback#keep-send-button-disabled-text
// spec:test product-feedback#show-feedback-thanks-after-successful
// spec:test product-feedback#ask-anything-besides-text-account
test("collects only nonempty feedback, shows the thanks character and returns to Profile", async () => {
  const requests = setupApi();
  const view = render(providers(<ProfilePage />));
  await openProfile();
  fireEvent.click(
    within(profileSection(t("profile.help"))).getByRole("button", { name: t("profile.feedback") }),
  );
  expect(navigation.push).toHaveBeenCalledWith("/app/profile/feedback");
  view.rerender(providers(<FeedbackPage />));

  const onlyInput = screen.getByRole("textbox", { name: t("profile.feedback") });
  expect(onlyInput.tagName).toBe("TEXTAREA");
  expect(screen.getAllByRole("textbox")).toHaveLength(1);
  expect(onlyInput.getAttribute("placeholder")).toBe(t("profile.feedback_hint"));
  const send = screen.getByRole("button", { name: t("extra.profile_feedback_send") });
  expect(send).toHaveProperty("disabled", true);
  fireEvent.change(onlyInput, { target: { value: " " } });
  expect(send).toHaveProperty("disabled", true);
  fireEvent.change(onlyInput, { target: { value: "  Another view would help.  " } });
  fireEvent.click(send);
  expect(await screen.findByRole("heading", { name: t("profile.feedback_thanks") })).toBeTruthy();
  expect(await requestFor(requests, "POST", "/feedback")?.json()).toEqual({
    text: "  Another view would help.  ",
    screen: "profile",
  });
  expect(view.container.querySelector(".profile-thanks img")?.getAttribute("src")).toBe(
    "/characters/celmento-master-red@200px.png",
  );
  fireEvent.click(screen.getByRole("button", { name: t("extra.close") }));
  expect(navigation.push).toHaveBeenLastCalledWith("/app/profile");
});

// spec:test account-profile#ask-confirmation-account-taps-logout
test("keeps the session when cancelling and signs out after confirmation", async () => {
  const requests = setupApi();
  render(providers(<ProfilePage />));
  await openProfile();
  const signOut = screen.getByRole("button", { name: t("profile.logout") });
  fireEvent.click(signOut);
  const confirmation = (): HTMLElement =>
    screen.getByRole("dialog", { name: t("extra.profile_logout_title") });
  expect(getSessionToken()).toBe(session);
  expect(requestFor(requests, "POST", "/auth/sign-out")).toBeUndefined();
  fireEvent.click(within(confirmation()).getByRole("button", { name: t("archive.cancel") }));
  expect(getSessionToken()).toBe(session);
  expect(navigation.replace).not.toHaveBeenCalled();

  fireEvent.click(signOut);
  fireEvent.click(within(confirmation()).getByRole("button", { name: t("profile.logout") }));
  await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith("/login"));
  expect(getSessionToken()).toBeNull();
  expect(requestFor(requests, "POST", "/auth/sign-out")?.headers.get("Authorization")).toBe(
    "Bearer " + session,
  );
});
