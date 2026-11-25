import { webcrypto } from "node:crypto";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { AppNavigationProvider } from "@/components/shell/navigation";
import { AccountProvider } from "@/lib/account";
import type { Schemas } from "@/lib/api/client";
import { t } from "@/lib/i18n/messages";
import { setSessionToken } from "@/lib/session";
import BalancePage from "./balance/page";
import EditClientPage from "./edit/page";
import ClientPage from "./page";
import EditPaymentPage from "./payments/[paymentId]/page";
import NewPaymentPage from "./payments/new/page";

const navigation = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  params: { id: "card-one", paymentId: "payment-current" },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => navigation,
  useParams: () => navigation.params,
}));

const api = "https://api.example.test";
const booking = "https://celmento.com/adalovelace";
const href = "/app/people/clients/card-one";
const session = "client-card-testing-session";
const today = "2026-11-25";
const instant = today + "T12:00:00Z";
const account: Schemas["Account"] = {
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
  address_url: booking,
  language: "en",
  time_zone: "UTC",
  activated: true,
  activated_at: instant,
  leader: {
    specializations: [],
    specialization_other: null,
    about: "",
    contact_email: null,
    links: [],
    main_channel: null,
    booking_url: booking,
    working_hours: [],
    session_duration_minutes: 60,
    session_format: "online",
    default_meeting_link: null,
    default_rate: null,
    default_currency: "USD",
    plan: { kind: "free", active_clients: 1, client_limit: 3, subscription_until: null },
  },
  acceptances: [],
  created_at: instant,
};

type Card = Schemas["ClientCard"];
type Summary = Schemas["BalanceSummary"];
type History = Schemas["ClientBalance"];
type Operation = Schemas["BalanceOperation"];

function balance(amount = "0", currency: Schemas["Currency"] = "USD"): Summary {
  return { balance: { amount, currency }, sessions_left: null, unpaid_sessions: null };
}

function card(overrides: Partial<Card> = {}): Card {
  return {
    id: "card-one",
    name: "Grace Hopper",
    photo_url: null,
    email: null,
    phone: null,
    telegram: null,
    whatsapp: null,
    other_contact: null,
    preferred_channel: null,
    rate: "12.35",
    currency: "USD",
    request: null,
    goals: null,
    info: null,
    hypotheses: null,
    status: "active",
    archived_at: null,
    linked: false,
    is_new: false,
    source: "created",
    completed_sessions: 0,
    completed_hours: 0,
    balance: balance(),
    created_at: instant,
    self_given_email: null,
    link: { status: "standalone", method: null, login: null },
    payment_type: "paid",
    ...overrides,
  };
}

function operation(overrides: Partial<Operation> = {}): Operation {
  return {
    id: "payment-current",
    kind: "payment",
    amount: { amount: "10.01", currency: "USD" },
    date: today,
    comment: "Current payment",
    created_by_system: false,
    created_at: instant,
    meeting_id: null,
    editable: true,
    ...overrides,
  };
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
) => Response | undefined | Promise<Response | undefined>;

function setupApi(
  initial: Card = card(),
  history: History = { balance: initial.balance, items: [] },
  handle?: Handler,
): Request[] {
  const requests: Request[] = [];
  let current = initial;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (request: Request): Promise<Response> => {
      const url = new URL(request.url);
      if (url.origin !== api) throw new Error("Unexpected request origin.");
      const path = url.pathname.replace(/^\/api\/v1/u, "");
      requests.push(request.clone());

      const override = await handle?.(request, path);
      if (override) return override;
      if (path === "/account") return json(account);
      if (path === "/clients/card-one" && request.method === "GET") return json(current);
      if (path === "/clients/card-one/balance") return json(history);
      if (path === "/clients/card-one/meetings") return json({ upcoming: [], past: [] });
      if (path === "/clients/card-one" && request.method === "PATCH") {
        const changes: Schemas["ClientUpdate"] = await request.json();
        current = { ...current, ...changes };
        return json(current);
      }
      if (path === "/clients/card-one/link" && request.method === "PUT") {
        const { login }: Schemas["ClientLinkByLogin"] = await request.json();
        if (login === "missing_login") return json({ code: "link_login_not_found" }, 404);
        if (login === "already_linked") {
          return json(
            {
              code: "link_duplicate",
              details: { name: "Grace's other card", client_id: "other-card" },
            },
            409,
          );
        }
        current = {
          ...current,
          linked: true,
          link: { status: "linked", method: "login", login: login.toLowerCase() },
        };
        return json(current);
      }
      if (path === "/clients/card-one/link" && request.method === "DELETE") {
        current = {
          ...current,
          linked: false,
          link: { status: "standalone", method: null, login: null },
        };
        return json(current);
      }
      throw new Error("Unexpected request to " + path);
    }),
  );
  return requests;
}

function all(requests: Request[], method: string, path: string): Request[] {
  return requests.filter(
    (request) => request.method === method && new URL(request.url).pathname === "/api/v1" + path,
  );
}

function providers(page: ReactElement): ReactElement {
  return (
    <AccountProvider>
      <AppNavigationProvider>{page}</AppNavigationProvider>
    </AccountProvider>
  );
}

function typeInto(label: string | RegExp, value: string): void {
  fireEvent.change(screen.getByRole("textbox", { name: label }), { target: { value } });
}

function click(label: string): void {
  fireEvent.click(screen.getByRole("button", { name: label }));
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
  setSessionToken(session);
  navigation.params = { id: "card-one", paymentId: "payment-current" };
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

// spec:test client-card-view-edit#show-quick-actions-order-book
// spec:test client-card-view-edit#open-phone-dialer-telegram-whatsapp
// spec:test client-card-view-edit#show-reference-contacts-block-titled
// spec:test client-card-view-edit#show-client-link-block-self-given
// spec:test client-balance-payments#show-balance-block-screen-6-1
// spec:test client-rate-currency#show-rate-client-currency-balance
test("shows exact debt, ordered local contact actions and separate booking email", async () => {
  setupApi(
    card({
      phone: "+1 555 0100",
      email: "reference@example.test",
      telegram: "@grace_h",
      whatsapp: "+1 555 0101",
      other_contact: "Office extension",
      preferred_channel: "whatsapp",
      self_given_email: "booking@example.test",
      balance: { ...balance("-9007199254740993.01"), unpaid_sessions: "9007199254740993" },
    }),
  );
  const view = render(providers(<ClientPage />));
  await screen.findByRole("heading", { name: "Grace Hopper" });
  const actions = view.container.querySelector<HTMLElement>(".client-quick-actions");
  if (!actions) throw new Error("Expected quick actions.");
  expect([...actions.children].map((child) => child.textContent)).toEqual([
    "＋" + t("client.book"),
    "◉" + t("card.whatsapp"),
    "☎" + t("card.call"),
    "➤" + t("card.telegram"),
    "✉" + t("card.email"),
    "✎" + t("client.note"),
  ]);
  for (const [key, link] of [
    ["card.whatsapp", "https://wa.me/15550101"],
    ["card.call", "tel:+1%20555%200100"],
    ["card.telegram", "https://t.me/grace_h"],
    ["card.email", "mailto:reference@example.test"],
  ] as const) {
    expect(
      within(actions)
        .getByRole("link", { name: t(key) })
        .getAttribute("href"),
    ).toBe(link);
  }

  expect(screen.getByText("−9 007 199 254 740 993.01 $")).toBeTruthy();
  expect(screen.getByText(t("client.balance_debt", { N: "9 007 199 254 740 993" }))).toBeTruthy();
  expect(screen.getByText(t("client.rate", { amount: "12.35 $" }))).toBeTruthy();
  expect(screen.getByRole("button", { name: t("client.add_payment") })).toBeTruthy();
  click(t("client.history"));
  expect(navigation.push).toHaveBeenCalledWith(href + "/balance");

  const contacts = screen
    .getByRole("heading", { name: t("client.contacts_title") })
    .closest("section");
  if (!contacts) throw new Error("Expected the reference contacts block.");
  expect(within(contacts).getByText(t("client.contacts_hint"))).toBeTruthy();
  expect(within(contacts).getByText("reference@example.test")).toBeTruthy();
  expect(within(contacts).queryByText("booking@example.test")).toBeNull();
  expect(screen.getByText("booking@example.test")).toBeTruthy();
  expect(screen.queryByRole("textbox", { name: t("extra.client_booking_email") })).toBeNull();
});

// spec:test client-card-view-edit#collapse-empty-optional-block-single
// spec:test client-card-view-edit#mark-reference-contacts-client-link
// spec:test client-card-view-edit#show-only-book-note-quick
test("keeps optional private blocks as marked one-line edit entry points", async () => {
  setupApi();
  render(providers(<ClientPage />));
  await screen.findByRole("heading", { name: "Grace Hopper" });

  expect(screen.getByText(t("client.no_contacts_hint"))).toBeTruthy();
  expect(screen.queryByRole("link", { name: t("card.call") })).toBeNull();
  expect(screen.getByRole("button", { name: t("client.book") })).toBeTruthy();
  expect(screen.getByRole("button", { name: t("client.note") })).toBeTruthy();
  for (const [key, fragment] of [
    ["card.no_contacts", "contacts"],
    ["extra.client_add_request_goals", "request"],
    ["extra.client_add_info", "info"],
    ["extra.client_add_hypotheses", "hypotheses"],
  ] as const) {
    const row = screen.getByRole("button", { name: new RegExp(t(key), "u") });
    expect(within(row).getByText(t("client.only_you"))).toBeTruthy();
    fireEvent.click(row);
    expect(navigation.push).toHaveBeenLastCalledWith(href + "/edit#" + fragment);
  }
});

// spec:test client-card-profile-link#show-standalone-active-card-client
// spec:test client-card-profile-link#make-login-link-leader-enters
// spec:test client-card-profile-link#show-link-not-found-keep-saving
// spec:test client-card-profile-link#show-link-duplicate-name-other-card
// spec:test client-card-profile-link#show-linked-active-card-client
// spec:test client-card-profile-link#break-link-after-leader-confirms
// spec:test client-card-view-edit#open-system-share-menu-leader
test("offers sharing, rejects bad links, opens the matching card and unlinks after confirmation", async () => {
  const requests = setupApi();
  const share = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { userAgent: "Test browser", language: "en", share });
  render(providers(<ClientPage />));
  await screen.findByRole("heading", { name: "Grace Hopper" });

  const label = t("client.link_login");
  const save = screen.getByRole("button", { name: t("extra.client_save") });
  expect(screen.getByText(t("client.link_login_hint"))).toBeTruthy();
  expect(save).toHaveProperty("disabled", true);
  click(t("client.invite"));
  expect(share).toHaveBeenCalledWith({ text: t("extra.client_invite_text", { link: booking }) });

  typeInto(label, "AdaLovelace");
  expect(screen.getByRole("alert").textContent).toBe(t("client.link_not_found"));
  expect(save).toHaveProperty("disabled", true);
  expect(all(requests, "PUT", "/clients/card-one/link")).toHaveLength(0);

  typeInto(label, "missing_login");
  fireEvent.click(save);
  expect(await screen.findByText(t("client.link_not_found"))).toBeTruthy();
  expect(save).toHaveProperty("disabled", true);
  typeInto(label, "MISSING_LOGIN");
  expect(save).toHaveProperty("disabled", true);

  typeInto(label, "already_linked");
  fireEvent.click(save);
  const duplicate = await screen.findByRole("button", { name: "Grace's other card" });
  expect(screen.getByRole("alert").textContent).toBe(
    t("client.link_duplicate", { name: "Grace's other card" }),
  );
  expect(save).toHaveProperty("disabled", true);
  fireEvent.click(duplicate);
  expect(navigation.push).toHaveBeenLastCalledWith("/app/people/clients/other-card");

  typeInto(label, "https://celmento.com/Existing_Client");
  fireEvent.click(save);
  expect(await screen.findByText("celmento.com/existing_client")).toBeTruthy();
  expect(screen.queryByRole("textbox", { name: label })).toBeNull();
  expect(await all(requests, "PUT", "/clients/card-one/link").at(-1)?.json()).toEqual({
    login: "Existing_Client",
  });

  click(t("client.unlink"));
  let dialog = within(screen.getByRole("dialog", { name: t("client.unlink") }));
  expect(dialog.getByText(t("client.unlink_warning"))).toBeTruthy();
  expect(all(requests, "DELETE", "/clients/card-one/link")).toHaveLength(0);
  fireEvent.click(dialog.getByRole("button", { name: t("archive.cancel") }));
  expect(screen.getByText("celmento.com/existing_client")).toBeTruthy();
  click(t("client.unlink"));
  dialog = within(screen.getByRole("dialog", { name: t("client.unlink") }));
  fireEvent.click(dialog.getByRole("button", { name: t("client.unlink") }));
  expect(await screen.findByRole("textbox", { name: label })).toBeTruthy();
  expect(all(requests, "DELETE", "/clients/card-one/link")).toHaveLength(1);
});

// spec:test client-card-view-edit#open-screen-6-2-name-photo
// spec:test client-card-view-edit#accept-reference-contact-screen-6-2
// spec:test client-card-view-edit#offer-screen-6-2-fields-request
// spec:test client-rate-currency#lock-currency-field-screen-6-2
test("edits reference values without format checks or changing the linked login or booking email", async () => {
  const initial = card({
    linked: true,
    link: { status: "linked", method: "login", login: "grace_hopper" },
    self_given_email: "booking@example.test",
    balance: balance("12.35"),
  });
  const requests = setupApi(initial);
  const view = render(providers(<ClientPage />));
  await screen.findByRole("heading", { name: "Grace Hopper" });
  click(t("extra.client_actions"));
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: t("card.edit") }));
  expect(navigation.push).toHaveBeenCalledWith(href + "/edit");
  view.rerender(providers(<EditClientPage />));

  expect(await screen.findByRole("textbox", { name: t("new.name") })).toHaveProperty(
    "value",
    initial.name,
  );
  expect(screen.getByLabelText(t("extra.profile_edit_photo"))).toBeTruthy();
  expect(screen.queryByRole("textbox", { name: t("extra.client_booking_email") })).toBeNull();
  const currency = within(screen.getByRole("group", { name: t("client.currency") }));
  expect(
    currency.getAllByRole("button").every((button) => (button as HTMLButtonElement).disabled),
  ).toBe(true);
  expect(screen.getByText(t("client.currency_locked", { amount: "12.35 $" }))).toBeTruthy();

  for (const [label, hint] of [
    ["client.request", "client.request_hint"],
    ["client.goals", "client.goals_hint"],
    ["client.info", "client.info_hint"],
    ["client.hypotheses", "client.hypotheses_hint"],
  ] as const) {
    const field = screen.getByRole("textbox", { name: t(label) });
    expect(field.tagName).toBe("TEXTAREA");
    expect(field.getAttribute("placeholder")).toBe(t(hint));
    expect(field.hasAttribute("maxlength")).toBe(false);
  }

  typeInto(t("new.name"), "");
  expect(screen.getByRole("button", { name: t("extra.client_save") })).toHaveProperty(
    "disabled",
    true,
  );
  typeInto(t("new.name"), "Grace B. Hopper");
  typeInto(t("extra.client_email"), "  a private reference only  ");
  typeInto(t("client.request"), "A longer opening request");
  fireEvent.change(screen.getByRole("combobox", { name: t("client.preferred_channel") }), {
    target: { value: "email" },
  });
  click(t("extra.client_save"));
  await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith(href));
  expect(await all(requests, "PATCH", "/clients/card-one")[0]?.json()).toEqual({
    name: "Grace B. Hopper",
    email: "  a private reference only  ",
    preferred_channel: "email",
    request: "A longer opening request",
  });
  view.rerender(providers(<ClientPage />));
  expect(await screen.findByRole("heading", { name: "Grace B. Hopper" })).toBeTruthy();
  expect(screen.getByText("booking@example.test")).toBeTruthy();
  expect(screen.getByText("celmento.com/grace_hopper")).toBeTruthy();
});

// spec:test client-rate-currency#allow-changing-currency-screen-6-2
// spec:test client-rate-currency#offer-screen-6-2-rate-number
// spec:test client-rate-currency#offer-screen-6-2-payment-type
test("requires a new rate on currency change and requires the barter or free choice at zero", async () => {
  const requests = setupApi();
  render(providers(<EditClientPage />));
  expect(await screen.findByRole("textbox", { name: t("new.rate") })).toHaveProperty(
    "value",
    "12.35",
  );
  const currency = within(screen.getByRole("group", { name: t("client.currency") }));
  expect(currency.getAllByRole("button").map((button) => button.textContent)).toEqual([
    "RUB (₽)",
    "EUR (€)",
    "USD ($)",
  ]);
  fireEvent.click(currency.getByRole("button", { name: "EUR (€)" }));
  const label = t("client.currency_new_rate");
  expect(screen.getByRole("textbox", { name: label })).toHaveProperty("value", "");
  const save = screen.getByRole("button", { name: t("extra.client_save") });
  expect(save).toHaveProperty("disabled", true);
  typeInto(label, "-0.01");
  expect(save).toHaveProperty("disabled", true);

  typeInto(label, "0,00");
  expect(screen.getByRole("button", { name: t("form.paid") })).toHaveProperty("disabled", true);
  expect(save).toHaveProperty("disabled", true);
  click(t("form.barter"));
  expect(save).toHaveProperty("disabled", false);
  expect(screen.getByRole("button", { name: t("form.pro_bono") })).toHaveProperty(
    "disabled",
    false,
  );
  fireEvent.click(save);
  await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith(href));
  expect(await all(requests, "PATCH", "/clients/card-one")[0]?.json()).toEqual({
    currency: "EUR",
    rate: "0.00",
    payment_type: "barter",
  });
});

test("loads the card and edit avatars with authenticated media requests only", async () => {
  const original = api + "/media/not-a-public-client-photo.png";
  const requests = setupApi(card({ photo_url: original }), undefined, (_request, path) => {
    if (path === "/clients/card-one/photo") {
      return new Response("image bytes", { headers: { "Content-Type": "image/png" } });
    }
  });
  const revoke = vi.fn();
  class ObjectURL extends URL {
    static createObjectURL(): string {
      return "blob:owner-only-client-picture";
    }
    static revokeObjectURL(url: string): void {
      revoke(url);
    }
  }
  vi.stubGlobal("URL", ObjectURL);
  const view = render(providers(<ClientPage />));

  await waitFor(() =>
    expect(view.container.querySelector("img")?.getAttribute("src")).toBe(
      "blob:owner-only-client-picture",
    ),
  );
  view.rerender(providers(<EditClientPage />));
  await waitFor(() => {
    expect(view.container.querySelector("img")?.getAttribute("src")).toBe(
      "blob:owner-only-client-picture",
    );
    expect(all(requests, "GET", "/clients/card-one/photo")).toHaveLength(2);
  });
  expect(requests.every((request) => request.url !== original)).toBe(true);
  for (const request of all(requests, "GET", "/clients/card-one/photo")) {
    expect(request.headers.get("Authorization")).toBe("Bearer " + session);
    expect(request.cache).toBe("no-store");
  }
  expect(revoke).toHaveBeenCalledWith("blob:owner-only-client-picture");
});

// spec:test client-balance-payments#show-free-pro-bono-payment-type
// spec:test client-balance-payments#show-rate-not-set-set-rate-link-opens
test("shows the remaining balance and history with no new payment on a free card", async () => {
  setupApi(card({ rate: null, payment_type: "pro_bono", balance: balance("17.99") }));
  render(providers(<ClientPage />));
  await screen.findByRole("heading", { name: "Grace Hopper" });

  expect(screen.getByText("17.99 $")).toBeTruthy();
  expect(screen.getByText(t("client.free"))).toBeTruthy();
  expect(screen.getByText(t("client.rate_not_set"))).toBeTruthy();
  expect(screen.getByRole("button", { name: t("client.history") })).toBeTruthy();
  expect(screen.queryByRole("button", { name: t("client.add_payment") })).toBeNull();
  click(t("extra.set_rate"));
  expect(navigation.push).toHaveBeenCalledWith(href + "/edit#rate");
});

// spec:test client-balance-payments#open-screen-6-4-history-listing
// spec:test client-balance-payments#allow-editing-deleting-payment-recorded
test("lists signed history with original currencies and opens only editable payments", async () => {
  const current = card({ balance: balance("1.03") });
  const history: History = {
    balance: current.balance,
    items: [
      operation(),
      operation({ id: "previous-same-currency", editable: false, comment: "Older USD period" }),
      operation({
        id: "previous-other-currency",
        editable: false,
        comment: "Older EUR period",
        amount: { amount: "5.25", currency: "EUR" },
      }),
      operation({
        id: "meeting-charge",
        kind: "session_charge",
        created_by_system: true,
        amount: { amount: "-9.00", currency: "USD" },
        meeting_id: "meeting-one",
        comment: null,
        editable: false,
        date: "2026-11-20",
      }),
    ],
  };
  setupApi(current, history);
  const view = render(providers(<BalancePage />));
  await screen.findByRole("heading", { name: t("client.history") });
  expect(screen.getByText("1.03 $")).toBeTruthy();
  const rows = within(screen.getByRole("list")).getAllByRole("listitem");
  expect(rows.map((row) => row.querySelector("strong")?.textContent)).toEqual([
    t("op.payment"),
    t("op.payment"),
    t("op.payment"),
    t("op.session", { date: "20 November" }),
  ]);
  expect(rows.map((row) => row.textContent)).toEqual([
    expect.stringContaining("+10.01 $"),
    expect.stringContaining("Older USD period"),
    expect.stringContaining("+5.25 €"),
    expect.stringContaining("−9 $"),
  ]);
  expect(within(rows[1] as HTMLElement).queryByRole("button")).toBeNull();
  expect(within(rows[2] as HTMLElement).queryByRole("button")).toBeNull();
  fireEvent.click(within(rows[0] as HTMLElement).getByRole("button"));
  expect(navigation.push).toHaveBeenCalledWith(href + "/payments/payment-current");
  fireEvent.click(within(rows[3] as HTMLElement).getByRole("button"));
  expect(navigation.push).toHaveBeenLastCalledWith("/app/meetings/meeting-one");

  navigation.params.paymentId = "previous-same-currency";
  view.rerender(providers(<EditPaymentPage />));
  await screen.findByText(t("extra.auth_request_failed"));
  expect(screen.queryByRole("button", { name: t("card.delete") })).toBeNull();
  expect(screen.queryByRole("button", { name: t("extra.client_save") })).toBeNull();
});

// spec:test client-balance-payments#open-form-6-5-titled-add-payment
// spec:test client-balance-payments#show-quick-1-quick-5-quick-10-amount
test("multiplies large rates exactly and retries payment creation under the original key", async () => {
  const stored = new Map<string, History>();
  const current = card({ rate: "12345678901234.97" });
  const receipts = { balance: balance("123456789012349.70"), items: [operation()] };
  const requests = setupApi(current, undefined, (request, path) => {
    if (path === "/clients/card-one/payments" && request.method === "POST") {
      const key = request.headers.get("Idempotency-Key");
      if (!key) throw new Error("Expected an idempotency key.");
      const receipt = stored.get(key);
      if (receipt) return json(receipt, 201);
      stored.set(key, receipts);
      throw new TypeError("The connection closed after the commit.");
    }
  });
  vi.stubGlobal("crypto", webcrypto);
  const view = render(providers(<ClientPage />));
  await screen.findByRole("heading", { name: "Grace Hopper" });
  click(t("client.add_payment"));
  expect(navigation.push).toHaveBeenCalledWith(href + "/payments/new");
  view.rerender(providers(<NewPaymentPage />));
  await screen.findByRole("heading", { name: t("payment.title") });

  const amount = screen.getByRole("textbox", { name: /Amount/u });
  const date = screen.getByLabelText(t("payment.date"));
  const save = screen.getByRole("button", { name: t("extra.client_save") });
  const actualToday = new Date().toISOString().slice(0, 10);
  expect(date).toHaveProperty("value", actualToday);
  expect(date).toHaveProperty("max", actualToday);
  expect(save).toHaveProperty("disabled", true);
  fireEvent.change(amount, { target: { value: "0.00" } });
  expect(save).toHaveProperty("disabled", true);
  click(t("payment.quick_1"));
  expect(amount).toHaveProperty("value", "12345678901234.97");
  click(t("payment.quick_5"));
  expect(amount).toHaveProperty("value", "61728394506174.85");
  click(t("payment.quick_10"));
  expect(amount).toHaveProperty("value", "123456789012349.70");
  fireEvent.change(date, { target: { value: "9999-12-31" } });
  expect(save).toHaveProperty("disabled", true);
  fireEvent.change(date, { target: { value: actualToday } });
  const comment = screen.getByRole("textbox", { name: t("payment.comment") });
  expect(comment.getAttribute("placeholder")).toBe(t("payment.comment_hint"));
  fireEvent.change(comment, { target: { value: "Ten sessions" } });
  fireEvent.click(save);
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    t("extra.auth_network_error"),
  );
  expect(amount).toHaveProperty("value", "123456789012349.70");

  fireEvent.click(save);
  expect(
    await screen.findByRole("heading", {
      name: t("payment.saved", { amount: "123 456 789 012 349.70 $" }),
    }),
  ).toBeTruthy();
  const submissions = all(requests, "POST", "/clients/card-one/payments");
  const keys = submissions.map((request) => request.headers.get("Idempotency-Key"));
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBeTruthy();
  expect(keys[1]).toBe(keys[0]);
  expect(stored.size).toBe(1);
  expect(await Promise.all(submissions.map((request) => request.json()))).toEqual(
    Array(2).fill({ amount: "123456789012349.70", date: actualToday, comment: "Ten sessions" }),
  );
  click(t("extra.close"));
  expect(navigation.push).toHaveBeenLastCalledWith(href);
});

test("omits quick amounts for a paid card with no rate", async () => {
  setupApi(card({ rate: null }));
  render(providers(<NewPaymentPage />));
  await screen.findByRole("heading", { name: t("payment.title") });
  expect(screen.queryByRole("button", { name: t("payment.quick_1") })).toBeNull();
  expect(screen.queryByRole("button", { name: t("payment.quick_5") })).toBeNull();
  expect(screen.queryByRole("button", { name: t("payment.quick_10") })).toBeNull();
});

// spec:test client-balance-payments#open-payment-editing-payment-row
// spec:test client-balance-payments#ask-delete-confirm-before-deleting
test("edits a current payment and shows the exact negative balance before confirmed deletion", async () => {
  const current = card({ balance: balance("0.01") });
  const path = "/clients/card-one/payments/payment-current";
  const payment = operation({ amount: { amount: "100000000000000.02", currency: "USD" } });
  const requests = setupApi(
    current,
    { balance: current.balance, items: [payment] },
    (request, pathname) => {
      if (pathname === path && ["PATCH", "DELETE"].includes(request.method)) {
        return json({ balance: current.balance, items: [] });
      }
    },
  );
  const view = render(providers(<EditPaymentPage />));
  const amount = await screen.findByRole("textbox", { name: /Amount/u });
  expect(amount).toHaveProperty("value", payment.amount.amount);
  expect(screen.getByLabelText(t("payment.date"))).toHaveProperty("value", payment.date);
  expect(screen.getByRole("textbox", { name: t("payment.comment") })).toHaveProperty(
    "value",
    payment.comment,
  );
  click(t("card.delete"));
  let confirmation = within(screen.getByRole("dialog", { name: t("extra.payment_delete_title") }));
  expect(confirmation.getByText(new RegExp(t("payment.delete_confirm"), "u"))).toBeTruthy();
  expect(confirmation.getByText(/Balance will be −100 000 000 000 000\.01 \$/u)).toBeTruthy();
  expect(all(requests, "DELETE", path)).toHaveLength(0);
  fireEvent.click(confirmation.getByRole("button", { name: t("archive.cancel") }));

  typeInto(/Amount/u, "10.02");
  fireEvent.change(screen.getByLabelText(t("payment.date")), { target: { value: "2026-11-20" } });
  typeInto(t("payment.comment"), "Corrected");
  click(t("extra.client_save"));
  await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith(href + "/balance"));
  const patch = all(requests, "PATCH", path)[0];
  expect(await patch?.json()).toEqual({
    amount: "10.02",
    date: "2026-11-20",
    comment: "Corrected",
  });
  expect(patch?.headers.has("Idempotency-Key")).toBe(false);

  view.rerender(providers(<BalancePage />));
  await screen.findByRole("heading", { name: t("client.history") });
  view.rerender(providers(<EditPaymentPage />));
  await screen.findByRole("heading", { name: t("payment.title") });
  click(t("card.delete"));
  confirmation = within(screen.getByRole("dialog", { name: t("extra.payment_delete_title") }));
  fireEvent.click(confirmation.getByRole("button", { name: t("card.delete") }));
  await waitFor(() => expect(navigation.replace).toHaveBeenCalledTimes(2));
  expect(navigation.replace).toHaveBeenLastCalledWith(href + "/balance");
  expect(all(requests, "DELETE", path)[0]?.headers.has("Idempotency-Key")).toBe(false);
});

// spec:test client-balance-payments#allow-adding-editing-deleting-payment
test("keeps payment controls unavailable for an archived card, including direct URLs", async () => {
  const current = card({ status: "archived", archived_at: instant, balance: balance("10.01") });
  const requests = setupApi(current, {
    balance: current.balance,
    items: [operation({ editable: false })],
  });
  const view = render(providers(<ClientPage />));
  await screen.findByRole("heading", { name: current.name });
  expect(screen.queryByRole("button", { name: t("client.add_payment") })).toBeNull();
  view.rerender(providers(<NewPaymentPage />));
  await screen.findByRole("heading", { name: t("payment.title") });
  expect(screen.queryByRole("button", { name: t("extra.client_save") })).toBeNull();
  view.rerender(providers(<EditPaymentPage />));
  await screen.findByText(t("extra.auth_request_failed"));
  expect(screen.queryByRole("button", { name: t("card.delete") })).toBeNull();
  expect(screen.queryByRole("button", { name: t("extra.client_save") })).toBeNull();
  expect(requests.every((request) => request.method === "GET")).toBe(true);
});
