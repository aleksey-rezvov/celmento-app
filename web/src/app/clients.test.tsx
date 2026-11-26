import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ComponentPropsWithoutRef, ReactElement } from "react";
import { afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { ClientAvatar } from "@/components/clients/ClientAvatar";
import { ClientForm } from "@/components/clients/ClientForm";
import type { Schemas } from "@/lib/api/client";
import { t } from "@/lib/i18n";
import { limitScreenHref, newClientPath, peoplePath } from "@/lib/limit";
import { setSessionToken } from "@/lib/session";
import AppLayout from "./(app)/app/layout";
import Limit from "./(app)/app/limit/page";
import ClientCard from "./(app)/app/people/clients/[id]/page";
import NewClient from "./(app)/app/people/clients/new/page";
import People from "./(app)/app/people/page";

const navigation = vi.hoisted(() => ({
  router: { push: vi.fn(), replace: vi.fn() },
  pathname: "/app/people",
  id: "",
  query: "",
}));

vi.mock("next/navigation", () => ({
  useRouter: () => navigation.router,
  useParams: () => ({ id: navigation.id }),
  usePathname: () => navigation.pathname,
  useSearchParams: () => new URLSearchParams(navigation.query),
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

type Account = Schemas["Account"];
type Client = Schemas["ClientListItem"];
type Card = Schemas["ClientCard"];
type Plan = Schemas["PlanStatus"];

const token = "test-client-session";
const origin = "https://world-api.example.test";
const bookingUrl = "https://celmento.com/adacoach";
const createdAt = "2026-11-16T12:00:00Z";
const firstId = "019ac7a0-0000-7ab1-b031-111111111111";
const secondId = "019ac7a0-0000-7ab1-b031-222222222222";
const thirdId = "019ac7a0-0000-7ab1-b031-333333333333";
const zero: Client["balance"] = {
  balance: { amount: "0", currency: "EUR" },
  sessions_left: null,
  unpaid_sessions: null,
};

function freePlan(active: number): Plan {
  return { kind: "free", active_clients: active, client_limit: 3, subscription_until: null };
}

function accountFor(
  plan: Plan | null,
  language: Account["language"] = "en",
  rate: string | null = "125.50",
): Account {
  return {
    id: "019ac7a0-0000-7ab1-b031-999999999999",
    contour: "world",
    email: "ada@example.test",
    first_name: "Ada",
    last_name: "Lovelace",
    photo_url: null,
    phone: null,
    telegram: null,
    whatsapp: null,
    login: "adacoach",
    address_url: bookingUrl,
    language,
    time_zone: "Europe/Belgrade",
    activated: plan !== null,
    activated_at: plan ? createdAt : null,
    leader: plan
      ? {
          specializations: [],
          specialization_other: null,
          about: "",
          contact_email: "ada@example.test",
          links: [],
          main_channel: null,
          booking_url: bookingUrl,
          working_hours: [],
          session_duration_minutes: 60,
          session_format: "online",
          default_meeting_link: null,
          default_rate: rate,
          default_currency: "EUR",
          plan,
        }
      : null,
    acceptances: [],
    created_at: createdAt,
  };
}

function client(id: string, name: string, fields: Partial<Client> = {}): Client {
  return {
    id,
    name,
    photo_url: null,
    status: "active",
    archived_at: null,
    linked: false,
    is_new: false,
    completed_sessions: 0,
    last_meeting_at: null,
    balance: zero,
    ...fields,
  };
}

const savedCard: Card = {
  id: firstId,
  name: "Nora Silva",
  photo_url: null,
  phone: null,
  email: null,
  telegram: null,
  whatsapp: null,
  other_contact: null,
  preferred_channel: null,
  rate: null,
  currency: "EUR",
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
  balance: zero,
  created_at: createdAt,
  self_given_email: null,
  link: { status: "standalone", method: null, login: null },
  payment_type: "paid",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function mockApi(respond: (request: Request, url: URL) => Response | Promise<Response>): Request[] {
  const requests: Request[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (request: Request) => {
      requests.push(request.clone());
      return respond(request, new URL(request.url));
    }),
  );
  return requests;
}

function signIn(
  account: Account,
  clients: (query: URLSearchParams) => Client[] = () => [],
): Request[] {
  setSessionToken(token);
  return mockApi((request, url) => {
    if (url.pathname === "/api/v1/account") return json(account);
    if (url.pathname === "/api/v1/notices")
      return json({ items: [] } satisfies Schemas["NoticeList"]);
    if (request.method === "POST" && url.pathname === "/api/v1/plans/limit-hits" && account.leader)
      return json(account.leader.plan);
    if (request.method === "GET" && url.pathname === "/api/v1/clients" && account.leader) {
      return json({
        items: clients(url.searchParams),
        plan: account.leader.plan,
      } satisfies Schemas["ClientList"]);
    }
    throw new Error(`Unexpected ${request.method} request to ${url.pathname}`);
  });
}

function atPath(pathname: string, page: ReactElement): ReactElement {
  navigation.pathname = pathname;
  return <AppLayout>{page}</AppLayout>;
}

function changeField(label: string, value: string): void {
  fireEvent.change(screen.getByRole("textbox", { name: label }), { target: { value } });
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
  document.documentElement.lang = "en";
  navigation.pathname = peoplePath;
  navigation.id = firstId;
  navigation.query = "";
  navigation.router.push.mockReset();
  navigation.router.replace.mockReset();
  vi.stubEnv("NEXT_PUBLIC_CLM_APP_CONTOUR", "world");
  vi.stubEnv("NEXT_PUBLIC_CLM_APP_API_URL", origin);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

// spec:test client-list#show-clients-section-titled-people
// spec:test client-list#open-clients-section-active-clients
// spec:test client-list#show-green-balance-plus-badge-number
// spec:test client-list#show-red-balance-debt-badge-number
// spec:test client-list#show-no-balance-badge-balance
// spec:test client-list#show-in-app-icon-row-client
// spec:test client-list#show-limit-counter-section-title-free
test("opens Active above My specialists and renders exact localized balance badges and link info", async () => {
  const requests = signIn(accountFor(freePlan(3), "ru"), () => [
    client(firstId, "Алиса", {
      linked: true,
      balance: {
        balance: { amount: "501", currency: "EUR" },
        sessions_left: "1.25",
        unpaid_sessions: null,
      },
    }),
    client(secondId, "Борис", {
      balance: {
        balance: { amount: "-250", currency: "EUR" },
        sessions_left: null,
        unpaid_sessions: "0.5",
      },
    }),
    client(thirdId, "Вера", { balance: { ...zero, balance: { amount: "100", currency: "EUR" } } }),
  ]);
  render(atPath(peoplePath, <People />));
  expect(await screen.findByRole("link", { name: "Алиса" })).toBeDefined();
  const section = within(screen.getByRole("region", { name: "Клиенты" }));
  expect(section.getByRole("button", { name: "Активные" }).getAttribute("aria-pressed")).toBe(
    "true",
  );
  expect(section.getByText("3 из 3 клиентов").getAttribute("data-reached")).toBe("true");
  expect(section.getByText("+1,25 сесс.").classList.contains("client-balance-credit")).toBe(true);
  expect(section.getByText("Долг 0,5 сесс.").classList.contains("client-balance-debt")).toBe(true);
  expect(section.getAllByRole("listitem")[2]?.querySelector(".client-balance-badge")).toBeNull();
  expect(
    within(screen.getByRole("main"))
      .getAllByRole("heading", { level: 2 })
      .map((h) => h.textContent),
  ).toEqual([t("clients.title", undefined, "ru"), t("c.my_specialists", undefined, "ru")]);
  const list = requests.find((request) => request.url.includes("/api/v1/clients?"));
  expect(list?.url).toBe(`${origin}/api/v1/clients?status=active`);
  expect(list?.headers.get("Authorization")).toBe(`Bearer ${token}`);

  fireEvent.click(section.getByRole("button", { name: t("clients.in_app", undefined, "ru") }));
  const dialog = await screen.findByRole("dialog", { name: t("clients.in_app", undefined, "ru") });
  expect(within(dialog).getByText(t("clients.in_app_hint", undefined, "ru"))).toBeDefined();
  fireEvent.click(within(dialog).getByRole("button", { name: t("extra.close", undefined, "ru") }));
  expect(screen.queryByRole("dialog")).toBeNull();
});

// spec:test client-list#filter-clients-section-name-reference
// spec:test client-list#open-client-card-row-tapped
// spec:test client-list#show-not-found-character-empty-add
// spec:test client-archive-restore#show-archive-list-leader-switches
test("switches to Archive and searches both statuses by sending only the query", async () => {
  const active = client(firstId, "Ada Green");
  const archived = client(secondId, "Zoe Green", { status: "archived", archived_at: createdAt });
  let archive = [archived];
  const requests = signIn(accountFor(freePlan(1)), (query) => {
    if (query.has("q")) return query.get("q") === "@reference" ? [active, archived] : [];
    return query.get("status") === "archived" ? archive : [active];
  });
  render(atPath(peoplePath, <People />));
  expect(await screen.findByRole("link", { name: active.name })).toBeDefined();

  fireEvent.click(screen.getByRole("button", { name: t("clients.archive") }));
  const row = (await screen.findByRole("link", { name: archived.name })).closest("li");
  expect(row?.getAttribute("data-archived")).toBe("true");
  expect(screen.getByText(t("clients.archived_on", { date: "16 November" }))).toBeDefined();
  expect(screen.queryByRole("link", { name: active.name })).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: t("extra.client_search") }));
  const input = screen.getByRole("searchbox", { name: t("extra.client_search") });
  expect(document.activeElement).toBe(input);
  fireEvent.change(input, { target: { value: " @reference " } });
  await screen.findByText(t("clients.in_archive"));
  const section = within(screen.getByRole("region", { name: t("clients.title") }));
  const links = section.getAllByRole("link");
  expect(links.map((link) => link.getAttribute("href"))).toEqual([
    `${peoplePath}/clients/${firstId}`,
    `${peoplePath}/clients/${secondId}`,
  ]);
  const search = requests.map(({ url }) => new URL(url)).find((url) => url.searchParams.has("q"));
  expect(search?.searchParams.get("q")).toBe("@reference");
  expect(search?.searchParams.has("status")).toBe(false);

  fireEvent.change(input, { target: { value: "missing" } });
  expect(await section.findByText(t("clients.not_found"))).toBeDefined();
  expect(section.getByRole("link", { name: t("clients.empty_add") }).getAttribute("href")).toBe(
    newClientPath,
  );
  expect(section.queryByRole("link", { name: archived.name })).toBeNull();

  archive = [];
  fireEvent.click(screen.getByRole("button", { name: t("extra.close") }));
  const empty = await section.findByText(t("clients.archive_empty"));
  expect(empty.parentElement?.querySelector("picture img")?.getAttribute("src")).toBe(
    "/characters/celmento-master-blue@200px.png",
  );
  expect(empty.parentElement?.querySelector("a, button")).toBeNull();
});

// spec:test client-list#show-empty-state-clients-section
// spec:test client-list#open-client-creation-form-empty-add
// spec:test client-list#open-client-creation-form-floating
test("offers creation, copying and system sharing when there are no client cards", async () => {
  const copy = vi.fn(async () => undefined);
  const share = vi.fn(async () => undefined);
  vi.stubGlobal("navigator", { language: "en-US", clipboard: { writeText: copy }, share });
  const requests = signIn(accountFor(freePlan(0)));
  render(atPath(peoplePath, <People />));

  const section = within(await screen.findByRole("region", { name: t("clients.title") }));
  const empty = await section.findByText(t("clients.empty"));
  expect(empty.parentElement?.querySelector("picture img")?.getAttribute("src")).toContain(
    "celmento-master-red",
  );
  expect(section.getByRole("link", { name: t("clients.empty_add") }).getAttribute("href")).toBe(
    newClientPath,
  );
  const menu = within(screen.getByRole("navigation"));
  expect(menu.getByRole("link", { name: t("clients.empty_add") }).getAttribute("href")).toBe(
    newClientPath,
  );
  fireEvent.click(section.getByRole("button", { name: t("clients.empty_copy_link") }));
  expect(await section.findByText(t("profile.link_copied"))).toBeDefined();
  expect(copy).toHaveBeenCalledExactlyOnceWith(bookingUrl);
  fireEvent.click(section.getByRole("button", { name: t("client.invite") }));
  expect(share).toHaveBeenCalledExactlyOnceWith({ text: bookingUrl });
  expect(section.getByText(t("clients.empty_hint"))).toBeDefined();
  expect(requests.some((request) => request.url.endsWith("/clients?status=archived"))).toBe(true);
});

test("distinguishes a leader with only archived cards from a leader with no cards", async () => {
  signIn(accountFor(freePlan(0)), (query) =>
    query.get("status") === "archived"
      ? [client(firstId, "Former Client", { status: "archived", archived_at: createdAt })]
      : [],
  );
  render(atPath(peoplePath, <People />));

  expect(await screen.findByText(t("extra.clients_no_active"))).toBeDefined();
  expect(screen.queryByText(t("clients.empty"))).toBeNull();
  expect(screen.queryByRole("button", { name: t("clients.empty_copy_link") })).toBeNull();
});

// spec:test client-list#show-limit-counter-leader-subscription
// spec:test client-card-create#open-creation-form-floating-people
test("offers creation without the counter for a subscription above three active cards", async () => {
  signIn(
    accountFor({
      kind: "subscription",
      active_clients: 4,
      client_limit: null,
      subscription_until: "2027-11-16",
    }),
  );
  const view = render(atPath(peoplePath, <People />));
  const menu = await screen.findByRole("navigation");
  expect(
    within(menu)
      .getByRole("link", { name: t("clients.empty_add") })
      .getAttribute("href"),
  ).toBe(newClientPath);
  expect(screen.queryByText(t("clients.limit_counter", { N: 4 }))).toBeNull();

  view.rerender(atPath(newClientPath, <NewClient />));
  expect(await screen.findByRole("heading", { name: t("new.title") })).toBeDefined();
  expect(navigation.router.replace).not.toHaveBeenCalled();
});

// spec:test client-card-create#offer-card-creation-only-leader
test("keeps client list and direct creation unavailable for an unactivated account", async () => {
  const requests = signIn(accountFor(null));
  const view = render(atPath(peoplePath, <People />));
  const menu = await screen.findByRole("navigation");
  expect(within(menu).queryByRole("link", { name: t("clients.empty_add") })).toBeNull();
  expect(screen.queryByRole("region", { name: t("clients.title") })).toBeNull();
  expect(screen.getByRole("region", { name: t("c.my_specialists") })).toBeDefined();

  view.rerender(atPath(newClientPath, <NewClient />));
  await waitFor(() => expect(navigation.router.replace).toHaveBeenCalledWith(peoplePath));
  expect(screen.queryByRole("heading", { name: t("new.title") })).toBeNull();
  expect(requests.some((request) => request.url.includes("/api/v1/clients"))).toBe(false);
});

// spec:test client-card-create#check-free-plan-limit-before
// spec:test character-illustrations#show-celmento-master-blue-celmento-master-red
// spec:test free-plan-client-limit#show-new-client-screen-10-1-card
// spec:test free-plan-client-limit#return-screen-action-started-people
test("routes a capped leader to the limit view before showing any creation fields", async () => {
  const requests = signIn(accountFor(freePlan(3)), () => [client(firstId, "Ada")]);
  const view = render(atPath(peoplePath, <People />));
  const menu = await screen.findByRole("navigation");
  const plus = within(menu).getByRole("link", { name: t("clients.empty_add") });
  const destination = limitScreenHref("new_client", { returnTo: peoplePath });
  expect(plus.getAttribute("href")).toBe(destination);

  view.rerender(atPath(newClientPath, <NewClient />));
  await waitFor(() => expect(navigation.router.replace).toHaveBeenCalledWith(destination));
  expect(screen.queryByRole("textbox", { name: t("new.name") })).toBeNull();
  expect(requests.some(({ method }) => method === "POST")).toBe(false);

  navigation.query = new URL(destination, origin).search;
  view.rerender(atPath("/app/limit", <Limit />));
  expect(await screen.findByRole("heading", { name: t("limit.new_client") })).toBeDefined();
  expect(screen.getByRole("link", { name: t("extra.back") }).getAttribute("href")).toBe(peoplePath);
  expect(screen.getByRole("link", { name: t("limit.open_clients") }).getAttribute("href")).toBe(
    peoplePath,
  );
  expect(screen.getByText(t("limit.history_kept"))).toBeDefined();
  expect(
    [...screen.getByRole("main").querySelectorAll("picture img")].map((image) =>
      image.getAttribute("src"),
    ),
  ).toEqual([
    "/characters/celmento-master-blue@200px.png",
    "/characters/celmento-master-red@200px.png",
  ]);
});

// spec:test client-archive-restore#open-limit-screen-restore-text
// spec:test free-plan-client-limit#show-new-client-screen-10-1-card
// spec:test free-plan-client-limit#return-screen-action-started-people
test("loads the authorized client name on the restore limit screen and returns to that card", async () => {
  setSessionToken(token);
  const signedIn = accountFor(freePlan(3), "ru");
  const archived: Card = {
    ...savedCard,
    name: "Имя до загрузки лимита",
    status: "archived",
    archived_at: createdAt,
  };
  const currentName = "Имя из авторизованной карточки";
  const cardHref = `${peoplePath}/clients/${archived.id}`;
  const cardApiPath = `/api/v1/clients/${archived.id}`;
  let lookupCount = 0;
  let releaseLookup: (response: Response) => void = () => undefined;
  const pending = new Promise<Response>((resolve) => {
    releaseLookup = resolve;
  });
  const requests = mockApi((request, url) => {
    if (url.pathname === "/api/v1/account") return json(signedIn);
    if (url.pathname === "/api/v1/plans/limit-hits" && request.method === "POST")
      return json(freePlan(3));
    if (url.pathname === "/api/v1/notices") return json({ items: [] });
    if (url.pathname === cardApiPath + "/meetings") return json({ upcoming: [], past: [] });
    if (url.pathname === cardApiPath + "/notes")
      return json({ items: [] } satisfies Schemas["ClientNoteList"]);
    if (request.method === "POST" && url.pathname === cardApiPath + "/restore")
      return json({ code: "client_limit_reached" }, 409);
    if (request.method === "GET" && url.pathname === cardApiPath) {
      lookupCount += 1;
      return lookupCount === 2
        ? pending
        : json({ ...archived, name: lookupCount > 2 ? currentName : archived.name });
    }
    throw new Error(`Unexpected ${request.method} request to ${url.pathname}`);
  });
  const view = render(atPath(cardHref, <ClientCard />));
  await screen.findByRole("heading", { name: archived.name });
  fireEvent.click(screen.getByRole("button", { name: t("archive.restore", undefined, "ru") }));

  const limitHref = `/app/limit?reason=restore&client_id=${archived.id}`;
  await waitFor(() => expect(navigation.router.push).toHaveBeenCalledExactlyOnceWith(limitHref));
  expect(requests.filter(({ method }) => method === "POST").map(({ url }) => url)).toEqual([
    `${origin}${cardApiPath}/restore`,
  ]);
  navigation.query = new URL(limitHref, origin).search;
  view.rerender(atPath("/app/limit", <Limit />));
  await waitFor(() => expect(lookupCount).toBe(2));
  expect(view.container.querySelector('[aria-busy="true"]')).toBeTruthy();
  expect(screen.queryByText(archived.name, { exact: false })).toBeNull();
  releaseLookup(json({ ...archived, name: currentName }));

  const message = t("limit.restore", { имя: currentName }, "ru");
  expect(await screen.findByRole("heading", { name: message })).toBeDefined();
  const authorized = requests.filter(
    ({ method, url }) => method === "GET" && new URL(url).pathname === cardApiPath,
  );
  expect(authorized[1]?.headers.get("Authorization")).toBe(`Bearer ${token}`);
  const back = screen.getByRole("link", { name: t("extra.back", undefined, "ru") });
  expect(back.getAttribute("href")).toBe(cardHref);

  navigation.query = "";
  view.rerender(atPath(cardHref, <ClientCard />));
  expect(await screen.findByRole("heading", { name: currentName })).toBeDefined();
  expect(screen.getByRole("button", { name: t("archive.restore", undefined, "ru") })).toBeDefined();
});

test("handles malformed, inaccessible and retriable restore limit lookups", async () => {
  setSessionToken(token);
  let fail = true;
  const requests = mockApi((request, url) => {
    if (url.pathname === "/api/v1/account") return json(accountFor(freePlan(3)));
    if (url.pathname === "/api/v1/plans/limit-hits" && request.method === "POST")
      return json(freePlan(3));
    if (url.pathname.endsWith(secondId)) return json({ code: "not_found", name: "Spoofed" }, 404);
    if (url.pathname.endsWith(firstId) && request.method === "GET") {
      if (fail) {
        fail = false;
        throw new TypeError("Offline");
      }
      return json({ ...savedCard, status: "archived", archived_at: createdAt });
    }
    throw new Error(`Unexpected ${request.method} request to ${url.pathname}`);
  });
  navigation.query = "reason=restore&client_id=bad-id&clientName=Spoofed&returnTo=/app/profile";
  const view = render(atPath("/app/limit", <Limit />));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", t("clients.not_found"));
  expect(screen.getByRole("link", { name: t("extra.back") }).getAttribute("href")).toBe(peoplePath);
  expect(requests.filter(({ url }) => url.includes("/clients/")).length).toBe(0);
  expect(screen.queryByText(/Spoofed/u)).toBeNull();

  navigation.query = `reason=restore&client_id=${secondId}`;
  view.rerender(atPath("/app/limit", <Limit />));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", t("clients.not_found"));
  expect(screen.getByRole("link", { name: t("extra.back") }).getAttribute("href")).toBe(peoplePath);
  expect(screen.queryByText(/Spoofed/u)).toBeNull();

  navigation.query = `reason=restore&client_id=${firstId}`;
  view.rerender(atPath("/app/limit", <Limit />));
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    t("extra.auth_network_error"),
  );
  fireEvent.click(screen.getByRole("button", { name: t("extra.auth_retry") }));
  expect(
    await screen.findByRole("heading", { name: t("limit.restore", { name: savedCard.name }) }),
  ).toBeDefined();
});

// spec:test client-card-create#show-screen-5-3-field-name
// spec:test client-card-create#enable-save-button-only-name
// spec:test client-card-create#apply-payment-type-rules
// spec:test client-card-create#offer-self-given-email-link-login-field
// spec:test client-card-create#ask-other-card-field-creation
// spec:test client-card-create#create-card-save-standalone-card
test("prefills the full form, saves the third card with exact reference contacts and an explicit type at zero", async () => {
  setSessionToken(token);
  let count = 2;
  const requests = mockApi((request, url) => {
    if (url.pathname === "/api/v1/account") return json(accountFor(freePlan(count)));
    if (request.method === "POST" && url.pathname === "/api/v1/clients") {
      count += 1;
      return json({ ...savedCard, rate: "0.00", currency: "USD", payment_type: "barter" }, 201);
    }
    throw new Error(`Unexpected request to ${url.pathname}`);
  });
  render(atPath(newClientPath, <NewClient />));

  expect(await screen.findByRole("heading", { name: t("new.title") })).toBeDefined();
  expect(screen.getByRole("heading", { name: t("client.contacts_title") })).toBeDefined();
  expect(screen.getByText(t("client.contacts_hint"))).toBeDefined();
  expect(screen.getByText(t("new.rate_hint"))).toBeDefined();
  const save = screen.getByRole("button", { name: t("extra.client_save") });
  expect(save).toHaveProperty("disabled", true);
  expect(screen.getByRole("textbox", { name: t("new.rate") })).toHaveProperty("value", "125.50");
  expect(screen.getByRole("button", { name: "EUR (€)" }).getAttribute("aria-pressed")).toBe("true");
  expect(screen.getByRole("button", { name: t("form.paid") }).getAttribute("aria-pressed")).toBe(
    "true",
  );
  expect(screen.getAllByRole("textbox")).toHaveLength(6);
  expect(screen.queryByRole("textbox", { name: t("client.link_login") })).toBeNull();

  changeField(t("new.name"), savedCard.name);
  expect(save).toHaveProperty("disabled", false);
  changeField(t("extra.client_email"), "  reference detail  ");
  changeField(t("profile.phone"), "Leave a note at the front desk");
  changeField(t("new.rate"), "0,00");
  expect(screen.getByRole("button", { name: t("form.paid") })).toHaveProperty("disabled", true);
  expect(save).toHaveProperty("disabled", true);
  fireEvent.click(screen.getByRole("button", { name: t("form.barter") }));
  fireEvent.click(screen.getByRole("button", { name: "USD ($)" }));
  expect(save).toHaveProperty("disabled", false);
  fireEvent.click(save);

  await waitFor(() =>
    expect(navigation.router.replace).toHaveBeenCalledWith(`${peoplePath}/clients/${firstId}`),
  );
  const post = requests.find(({ method }) => method === "POST");
  expect(await post?.json()).toMatchObject({
    name: savedCard.name,
    email: "  reference detail  ",
    phone: "Leave a note at the front desk",
    rate: "0.00",
    currency: "USD",
    payment_type: "barter",
  });
  expect(post?.headers.get("Idempotency-Key")).toMatch(/^[0-9a-f-]{36}$/u);
  expect(requests.filter(({ url }) => url.endsWith("/account"))).toHaveLength(2);
  expect(navigation.router.replace).toHaveBeenCalledTimes(1);
});

test("sends the same idempotency key on an unchanged retry and issues a new key for a changed card", async () => {
  setSessionToken(token);
  let submissions = 0;
  const requests = mockApi((request, url) => {
    if (url.pathname === "/api/v1/account") return json(accountFor(freePlan(0), "en", null));
    if (request.method !== "POST") throw new Error("Expected creation request.");
    submissions += 1;
    if (submissions < 3) throw new TypeError("Response lost");
    return json(savedCard, 201);
  });
  render(atPath(newClientPath, <NewClient />));
  const save = await screen.findByRole("button", { name: t("extra.client_save") });
  changeField(t("new.name"), "Nora");
  fireEvent.click(save);
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    t("extra.auth_network_error"),
  );
  expect(screen.getByRole("textbox", { name: t("new.name") })).toHaveProperty("value", "Nora");
  fireEvent.click(save);
  await waitFor(() => expect(submissions).toBe(2));
  await waitFor(() => expect(save).toHaveProperty("disabled", false));
  changeField(t("new.name"), savedCard.name);
  fireEvent.click(save);
  await waitFor(() =>
    expect(navigation.router.replace).toHaveBeenCalledWith(`${peoplePath}/clients/${firstId}`),
  );

  const posts = requests.filter(({ method }) => method === "POST");
  const keys = posts.map((request) => request.headers.get("Idempotency-Key"));
  expect(keys).toHaveLength(3);
  expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/u);
  expect(keys[1]).toBe(keys[0]);
  expect(keys[2]).not.toBe(keys[0]);
  expect(await posts[0]?.json()).toMatchObject({ name: "Nora", rate: null, payment_type: "paid" });
});

test("lets the server copy pricing defaults on the short form and returns the created card", async () => {
  setSessionToken(token);
  const onCreated = vi.fn();
  const requests = mockApi((request, url) => {
    if (url.pathname === "/api/v1/account") return json(accountFor(freePlan(0), "en", "0"));
    if (request.method === "POST" && url.pathname === "/api/v1/clients")
      return json({ ...savedCard, payment_type: "pro_bono" }, 201);
    throw new Error(`Unexpected request to ${url.pathname}`);
  });
  render(
    atPath(
      "/app/meetings/new",
      <ClientForm mode="short" defaults={{ rate: "0", currency: "EUR" }} onCreated={onCreated} />,
    ),
  );

  const save = await screen.findByRole("button", { name: t("extra.client_save") });
  expect(screen.queryByRole("textbox", { name: t("new.rate") })).toBeNull();
  expect(screen.queryByRole("button", { name: t("form.paid") })).toBeNull();
  changeField(t("new.name"), savedCard.name);
  fireEvent.click(save);
  await waitFor(() =>
    expect(onCreated).toHaveBeenCalledExactlyOnceWith({ ...savedCard, payment_type: "pro_bono" }),
  );

  const post = requests.find(({ method }) => method === "POST");
  expect(await post?.json()).toEqual({
    name: savedCard.name,
    email: null,
    phone: null,
    telegram: null,
    whatsapp: null,
  });
});

test("routes a submission rejected by the latest server limit to the limit view", async () => {
  setSessionToken(token);
  let count = 2;
  const requests = mockApi((request, url) => {
    if (url.pathname === "/api/v1/account") return json(accountFor(freePlan(count)));
    if (request.method === "POST") {
      count = 3;
      return json({ code: "client_limit_reached" }, 409);
    }
    throw new Error(`Unexpected request to ${url.pathname}`);
  });
  render(atPath(newClientPath, <NewClient />));
  const save = await screen.findByRole("button", { name: t("extra.client_save") });
  changeField(t("new.name"), savedCard.name);
  fireEvent.click(save);

  const destination = limitScreenHref("new_client", { returnTo: peoplePath });
  await waitFor(() => expect(navigation.router.replace).toHaveBeenCalledWith(destination));
  expect(navigation.router.replace).not.toHaveBeenCalledWith(`${peoplePath}/clients/${firstId}`);
  expect(requests.filter(({ url }) => url.endsWith("/account"))).toHaveLength(2);
});

test("loads the client photo from the authenticated API and revokes replaced and unmounted object URLs", async () => {
  setSessionToken(token);
  const create = vi
    .fn()
    .mockReturnValueOnce("blob:client-photo-first")
    .mockReturnValueOnce("blob:client-photo-second");
  const revoke = vi.fn();
  const NativeUrl = URL;
  vi.stubGlobal(
    "URL",
    class extends NativeUrl {
      static createObjectURL = create;
      static revokeObjectURL = revoke;
    },
  );
  const photo = (): Response =>
    new Response("png bytes", { headers: { "Content-Type": "image/png" } });
  let releaseFirst: () => void = () => {
    throw new Error("Photo fixture not initialized.");
  };
  const firstPhoto = new Promise<Response>((resolve) => {
    releaseFirst = () => resolve(photo());
  });
  let photoReads = 0;
  const requests = mockApi((_request, url) => {
    if (url.pathname === "/api/v1/account") return json(accountFor(freePlan(0)));
    if (url.pathname === `/api/v1/clients/${firstId}/photo`) {
      return ++photoReads === 1 ? firstPhoto : photo();
    }
    throw new Error("Unexpected read " + url.pathname);
  });
  const route = (version: string): ReactElement =>
    atPath(
      peoplePath,
      <ClientAvatar
        clientId={firstId}
        name="Ada Lovelace"
        photoUrl={"https://untrusted.example/photo?v=" + version}
      />,
    );
  const view = render(route("first"));
  expect(await screen.findByText("AL")).toBeDefined();
  releaseFirst();
  await waitFor(() =>
    expect(view.container.querySelector("img")?.getAttribute("src")).toBe(
      "blob:client-photo-first",
    ),
  );
  const photoRequests = (): Request[] => requests.filter(({ url }) => !url.endsWith("/account"));
  expect(photoRequests()[0]?.url).toBe(`${origin}/api/v1/clients/${firstId}/photo`);
  expect(photoRequests()[0]?.headers.get("Authorization")).toBe(`Bearer ${token}`);
  expect(create).toHaveBeenCalledWith(expect.objectContaining({ type: "image/png" }));

  view.rerender(route("second"));
  await waitFor(() =>
    expect(view.container.querySelector("img")?.getAttribute("src")).toBe(
      "blob:client-photo-second",
    ),
  );
  expect(photoRequests()).toHaveLength(2);
  expect(revoke).toHaveBeenCalledWith("blob:client-photo-first");
  view.unmount();
  expect(revoke).toHaveBeenCalledWith("blob:client-photo-second");
});

test("does not send a queued creation from a form bound to the previous session", async () => {
  const requests = signIn(accountFor(freePlan(1)));
  render(atPath(newClientPath, <NewClient />));
  const name = await screen.findByRole("textbox", { name: t("new.name") });
  fireEvent.change(name, { target: { value: "Previous account's draft" } });
  const submit = screen.getByRole("button", { name: t("extra.client_save") });
  expect(submit).toHaveProperty("disabled", false);

  window.localStorage.setItem("celmento_app_session", "signed-in-after-the-render");
  fireEvent.click(submit);
  expect(requests.filter(({ method }) => method === "POST")).toHaveLength(0);
  expect(navigation.router.replace).not.toHaveBeenCalled();
});
