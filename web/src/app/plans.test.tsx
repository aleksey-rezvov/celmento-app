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
import { StrictMode, type ComponentPropsWithoutRef, type ReactElement } from "react";
import { afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import type { Schemas } from "@/lib/api/client";
import { t, type MessageKey } from "@/lib/i18n";
import { setSessionToken } from "@/lib/session";
import AppLayout from "./(app)/app/layout";
import Limit from "./(app)/app/limit/page";
import NewClient from "./(app)/app/people/clients/new/page";
import People from "./(app)/app/people/page";
import PlansLayout from "./(app)/app/plans/layout";
import Plans from "./(app)/app/plans/page";
import PlansSent from "./(app)/app/plans/sent/page";
import ProfileLayout from "./(app)/app/profile/layout";
import Profile from "./(app)/app/profile/page";

const navigation = vi.hoisted(() => ({
  router: { push: vi.fn<(path: string) => void>(), replace: vi.fn<(path: string) => void>() },
  open: vi.fn<(path: string) => void>(),
  pathname: "/app/profile",
  query: "",
}));

vi.mock("next/navigation", () => ({
  useRouter: () => navigation.router,
  usePathname: () => navigation.pathname,
  useSearchParams: () => new URLSearchParams(navigation.query),
}));

interface LinkProps extends ComponentPropsWithoutRef<"a"> {
  onNavigate?: (event: { preventDefault: () => void }) => void;
}

vi.mock("next/link", () => ({
  default: ({ href, onNavigate, ...props }: LinkProps): ReactElement => (
    <a
      {...props}
      href={href}
      onClick={(event) => {
        event.preventDefault();
        let blocked = false;
        onNavigate?.({
          preventDefault: () => {
            blocked = true;
          },
        });
        if (!blocked && href) navigation.open(href);
      }}
    />
  ),
}));

type Account = Schemas["Account"];
type Plan = Schemas["PlanStatus"];
type Receipt = Schemas["SubscriptionRequest"];
type Locale = Schemas["Language"];
type Overview = Schemas["PlansOverview"];

const apiOrigin = "https://world-api.example.test";
const token = "test-plans-session";
const rotatedToken = "test-plans-other-session";
const now = "2026-11-26T12:00:00Z";
const profile = "/app/profile";
const profilePlans = "/app/plans?source=profile";
const limit = "/app/limit?reason=new_client&returnTo=%2Fapp%2Fpeople";
const sent = "/app/plans/sent";

function free(activeClients = 3): Plan {
  return { kind: "free", client_limit: 3, active_clients: activeClients, subscription_until: null };
}

const subscribed: Plan = {
  kind: "subscription",
  client_limit: null,
  active_clients: 3,
  subscription_until: "2026-11-29",
};
const world: Account = {
  id: "019ac7a0-0000-7ab1-b031-111111111111",
  contour: "world",
  email: "leader@example.test",
  first_name: "Ada",
  last_name: "Lovelace",
  photo_url: null,
  phone: null,
  telegram: null,
  whatsapp: null,
  login: "ada",
  address_url: "https://celmento.com/ada",
  language: "en",
  time_zone: "Europe/Moscow",
  activated: true,
  activated_at: now,
  leader: {
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
    default_rate: "150",
    default_currency: "USD",
    plan: free(),
  },
  acceptances: [],
  created_at: now,
};

function accountPlan(account: Account, plan: Plan, requestedAt?: string): Account {
  if (!account.leader) throw new Error("Expected an activated account.");

  return {
    ...account,
    leader: { ...account.leader, plan, subscription_requested_at: requestedAt },
  };
}

function overview(account: Account, request: Receipt | null = null): Overview {
  if (!account.leader) throw new Error("Expected an activated account.");

  const russian = account.contour === "ru";
  const currency = russian ? "RUB" : "EUR";
  return {
    prices: {
      level: "base",
      items: [
        { term: "month", price: { amount: russian ? "790" : "8.90", currency } },
        { term: "year", price: { amount: russian ? "6300" : "71", currency } },
      ],
    },
    plan: account.leader.plan,
    request,
  };
}

function receipt(overrides: Partial<Receipt> = {}): Receipt {
  return {
    term: "year",
    level: "base",
    source: "profile",
    currency: "EUR",
    created_at: now,
    ...overrides,
  };
}

function json(result: unknown, status = 200): Response {
  return new Response(JSON.stringify(result), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

interface Captured {
  request: Request;
  path: string;
  screen: string;
}

type Serve = (path: string, request: Request) => Response | Promise<Response>;
function serve(respond: Serve, current: (session: string) => Account = () => world): Captured[] {
  const requests: Captured[] = [];
  setSessionToken(token);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (request: Request) => {
      const path = new URL(request.url).pathname.replace(/^\/api\/v1/u, "");
      const authorization = request.headers.get("authorization");
      if (!authorization?.startsWith("Bearer ")) throw new Error("Expected an authorized read.");
      const session = authorization.slice(7);
      requests.push({ request: request.clone(), path, screen: navigation.pathname });
      switch (path) {
        case "/account":
          return json(current(session));
        case "/notices":
          return json({ items: [] } satisfies Schemas["NoticeList"]);
        case "/specialists":
          return json({ items: [] } satisfies Schemas["SpecialistList"]);
        default:
          return respond(path, request);
      }
    }),
  );
  return requests;
}

function calls(requests: readonly Captured[], path: string): Captured[] {
  return requests.filter((request) => request.path === path);
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => {
    throw new Error("Promise not initialized.");
  };
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function frame(href: string): ReactElement {
  const url = new URL(href, apiOrigin);
  navigation.pathname = url.pathname;
  navigation.query = url.search;
  let page: ReactElement;
  switch (url.pathname) {
    case profile:
      page = (
        <ProfileLayout>
          <Profile />
        </ProfileLayout>
      );
      break;
    case "/app/plans":
      page = (
        <PlansLayout>
          <Plans />
        </PlansLayout>
      );
      break;
    case sent:
      page = (
        <PlansLayout>
          <PlansSent />
        </PlansLayout>
      );
      break;
    case "/app/limit":
      page = <Limit />;
      break;
    case "/app/people":
      page = <People />;
      break;
    case "/app/people/clients/new":
      page = <NewClient />;
      break;
    default:
      throw new Error("Unexpected test route " + url.pathname);
  }
  return (
    <StrictMode>
      <AppLayout>{page}</AppLayout>
    </StrictMode>
  );
}

function mount(href: string): RenderResult {
  const rendered = render(frame(href));
  navigation.open.mockImplementation((path) => rendered.rerender(frame(path)));
  navigation.router.push.mockImplementation((path) => queueMicrotask(() => navigation.open(path)));
  navigation.router.replace.mockImplementation((path) =>
    queueMicrotask(() => navigation.open(path)),
  );
  return rendered;
}

function inMainButton(key: MessageKey, language: Locale = "en"): HTMLElement {
  return within(screen.getByRole("main")).getByRole("button", {
    name: t(key, undefined, language),
  });
}

function currentCard(language: Locale = "en"): HTMLElement {
  const marker = screen.getByText(t("plans.current", undefined, language));
  const card = marker.closest("section");
  if (!card) throw new Error("The current marker is not on a plan card.");
  return card;
}

function refocus(): void {
  act(() => window.dispatchEvent(new Event("focus")));
}

const thanksTitle = (account: Account): string =>
  t("plans.thanks", { email: account.email, почта: account.email }, account.language);

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
  window.sessionStorage.clear();
  navigation.open.mockReset();
  navigation.router.push.mockReset();
  navigation.router.replace.mockReset();
  vi.stubEnv("NEXT_PUBLIC_CLM_APP_CONTOUR", "world");
  vi.stubEnv("NEXT_PUBLIC_CLM_APP_API_URL", apiOrigin);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(now));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

// spec:test subscription-plans-request#open-screen-10-2-titled-plans
// spec:test subscription-plans-request#show-plan-section-plan-free-n
// spec:test subscription-plans-request#show-two-cards-screen-10-2
// spec:test subscription-plans-request#mark-current-plan-current-free
// spec:test subscription-plans-request#show-month-year-toggle-subscription
// spec:test subscription-plans-request#show-monthly-price-month-selected
// spec:test subscription-plans-request#price-subscription-base-level-790-month
// spec:test subscription-plans-request#choose-price-currency-account-contour
// spec:test subscription-plans-request#show-want-subscription-card-open
// spec:test subscription-plans-request#store-request-account-contour-account
// spec:test subscription-plans-request#return-screen-10-2-screen-10-3
// spec:test subscription-plans-request#replace-want-request-sent-showing
// spec:test subscription-plans-request#take-payment-show-payment-form
test("opens Plans from Profile, sends one request, and closes the scoped confirmation", async () => {
  const pending = deferred<Response>();
  let recorded: Receipt | null = null;
  const requests = serve((path, request) => {
    if (path === "/plans" && request.method === "GET") return json(overview(world, recorded));
    if (path === "/subscription-requests" && request.method === "POST") return pending.promise;
    throw new Error("Unexpected " + request.method + " " + path);
  });
  mount(profile);

  const plans = await screen.findByRole("button", { name: t("profile.plans_button") });
  expect(screen.getByText(t("profile.plan_free", { N: 3 }))).toBeDefined();
  expect(calls(requests, "/plans")).toHaveLength(0);
  fireEvent.click(plans);
  expect(await screen.findByRole("heading", { name: t("plans.title") })).toBeDefined();
  await screen.findByText("8.90 €");
  expect(calls(requests, "/plans")).toHaveLength(1);
  expect(navigation.router.push).toHaveBeenCalledWith(profilePlans);
  expect(within(currentCard()).getByRole("heading", { name: t("plans.free") })).toBeDefined();
  expect(screen.getByText(t("plans.clients_3"))).toBeDefined();
  expect(screen.getByText(t("plans.clients_unlimited"))).toBeDefined();
  expect(screen.getAllByText(t("plans.all_features"))).toHaveLength(2);
  expect(screen.getByText(t("plans.soon"))).toBeDefined();
  expect(screen.getByText(t("plans.future_features"))).toBeDefined();
  expect(screen.getByRole("main").querySelector("input, form")).toBeNull();
  expect(inMainButton("plans.month").getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(inMainButton("plans.year"));
  expect(screen.getByText("71 €")).toBeDefined();
  expect(screen.getByText(t("plans.per_month", { amount: "5.92 €" }))).toBeDefined();
  expect(screen.getByText(t("plans.year_hint"))).toBeDefined();
  expect(calls(requests, "/plans")).toHaveLength(1);
  expect(calls(requests, "/subscription-requests")).toHaveLength(0);

  fireEvent.click(inMainButton("plans.want"));
  fireEvent.click(inMainButton("plans.want"));
  let submitted = calls(requests, "/subscription-requests");
  expect(submitted).toHaveLength(1);
  expect(submitted[0]?.request.headers.get("authorization")).toBe("Bearer " + token);
  expect(await submitted[0]?.request.json()).toEqual({ term: "year", source: "profile" });
  await act(async () => {
    recorded = receipt();
    pending.resolve(json(recorded, 201));
  });
  expect(await screen.findByRole("heading", { name: thanksTitle(world) })).toBeDefined();
  expect(screen.getByRole("main").querySelector("picture img")?.getAttribute("src")).toBe(
    "/characters/celmento-master-blue@200px.png",
  );
  expect(navigation.router.push).toHaveBeenLastCalledWith(sent);
  expect(navigation.query).toBe("");
  expect(calls(requests, "/plans")).toHaveLength(1);
  const close = screen.getByRole("link", { name: t("extra.close") });
  expect(close.getAttribute("href")).toBe(profilePlans);
  fireEvent.click(close);

  expect(
    await screen.findByText(t("plans.request_sent", { date: "26 November 2026" })),
  ).toBeDefined();
  expect(screen.queryByRole("button", { name: t("plans.want") })).toBeNull();
  expect(inMainButton("plans.month").getAttribute("aria-pressed")).toBe("true");
  expect(calls(requests, "/plans").map(({ screen }) => screen)).toEqual([
    "/app/plans",
    "/app/plans",
  ]);
  submitted = calls(requests, "/subscription-requests");
  expect(submitted).toHaveLength(1);
});

// spec:test subscription-plans-request#show-prices-dollars-currency-other
// spec:test subscription-plans-request#tie-subscription-currency-device-country
// spec:test free-plan-client-limit#open-screen-10-1-thoughtful-character
// spec:test free-plan-client-limit#show-buttons-open-clients-opening-active
// spec:test free-plan-client-limit#show-history-kept-buttons-screen-10-1
test("opens ruble Plans from the confirmed limit and keeps that origin through confirmation", async () => {
  vi.stubEnv("NEXT_PUBLIC_CLM_APP_CONTOUR", "ru");
  const russian: Account = {
    ...world,
    language: "ru",
    contour: "ru",
    address_url: "https://celmento.ru/ada",
  };
  let recorded: Receipt | null = null;
  const requests = serve(
    (path, request) => {
      if (path === "/plans/limit-hits" && request.method === "POST") return json(free());
      if (path === "/plans" && request.method === "GET") return json(overview(russian, recorded));
      if (path === "/subscription-requests" && request.method === "POST") {
        recorded = receipt({ term: "month", source: "limit_screen", currency: "RUB" });
        return json(recorded, 201);
      }
      throw new Error("Unexpected " + request.method + " " + path);
    },
    () => russian,
  );
  mount(limit);

  expect(
    await screen.findByRole("heading", { name: t("limit.new_client", undefined, "ru") }),
  ).toBeDefined();
  expect(screen.getByText(t("limit.history_kept", undefined, "ru"))).toBeDefined();
  const main = within(screen.getByRole("main"));
  expect(
    main.getByRole("link", { name: t("limit.open_clients", undefined, "ru") }).getAttribute("href"),
  ).toBe("/app/people");
  expect(
    main.getByRole("link", { name: t("extra.back", undefined, "ru") }).getAttribute("href"),
  ).toBe("/app/people");
  expect(screen.getByRole("main").querySelectorAll("picture")).toHaveLength(2);
  expect(calls(requests, "/plans/limit-hits")).toHaveLength(1);
  expect(calls(requests, "/plans")).toHaveLength(0);
  const entry = main.getByRole("link", { name: t("limit.plans", undefined, "ru") });
  const href = entry.getAttribute("href");
  if (!href) throw new Error("The limit screen has no Plans destination.");
  expect(new URL(href, apiOrigin).searchParams.get("source")).toBe("limit_screen");
  fireEvent.click(entry);

  await screen.findByText("790 ₽");
  fireEvent.click(inMainButton("plans.year", "ru"));
  expect(screen.getByText("6 300 ₽")).toBeDefined();
  expect(screen.getByText(t("plans.per_month", { сумма: "525 ₽" }, "ru"))).toBeDefined();
  expect(screen.getByText(t("plans.year_hint", undefined, "ru"))).toBeDefined();
  expect(screen.getByRole("main").textContent).not.toMatch(/[€$]/u);
  fireEvent.click(inMainButton("plans.month", "ru"));
  fireEvent.click(inMainButton("plans.want", "ru"));

  expect(await screen.findByRole("heading", { name: thanksTitle(russian) })).toBeDefined();
  expect(await calls(requests, "/subscription-requests")[0]?.request.json()).toEqual({
    source: "limit_screen",
    term: "month",
  });
  expect(calls(requests, "/plans")).toHaveLength(1);
  const close = screen.getByRole("link", { name: t("extra.close", undefined, "ru") });
  expect(close.getAttribute("href")).toBe(href);
  fireEvent.click(close);
  await screen.findByText(t("plans.request_sent", { дата: "26 ноября 2026 г." }, "ru"));
  expect(
    screen.getByRole("link", { name: t("extra.back", undefined, "ru") }).getAttribute("href"),
  ).toBe(limit);
  expect(calls(requests, "/plans")).toHaveLength(2);
  expect(calls(requests, "/plans/limit-hits")).toHaveLength(1);
});

test.each(["concurrency", "lost response"] as const)(
  "recovers the winning receipt after %s without another plans read",
  async (situation) => {
    let count = 0;
    const winner = receipt({ source: "limit_screen", term: "month" });
    const requests = serve((path, request) => {
      if (path === "/plans" && request.method === "GET") return json(overview(world));
      if (path === "/subscription-requests" && request.method === "POST") {
        if (++count === 1 && situation === "lost response") throw new TypeError("Lost response");
        return json({ code: "subscription_request_exists", details: { request: winner } }, 409);
      }
      throw new Error("Unexpected " + request.method + " " + path);
    });
    mount(profilePlans);

    await screen.findByText("8.90 €");
    fireEvent.click(inMainButton("plans.year"));
    fireEvent.click(inMainButton("plans.want"));
    if (situation === "lost response") {
      expect((await screen.findByRole("alert")).textContent).toBe(t("extra.auth_network_error"));
      fireEvent.click(inMainButton("plans.want"));
    }
    expect(await screen.findByRole("heading", { name: thanksTitle(world) })).toBeDefined();
    expect(calls(requests, "/plans")).toHaveLength(1);
    expect(calls(requests, "/subscription-requests")).toHaveLength(
      situation === "lost response" ? 2 : 1,
    );
    for (const write of calls(requests, "/subscription-requests")) {
      expect(await write.request.json()).toEqual({ term: "year", source: "profile" });
    }
  },
);

test("ignores a malformed or wrong-contour winning receipt without another counted GET", async () => {
  const requests = serve((path, request) => {
    if (path === "/plans" && request.method === "GET") return json(overview(world));
    if (path === "/subscription-requests" && request.method === "POST") {
      const wrongContour = receipt({ currency: "RUB" });
      return json({ code: "subscription_request_exists", details: { request: wrongContour } }, 409);
    }
    throw new Error("Unexpected " + request.method + " " + path);
  });
  mount(profilePlans);

  await screen.findByText("8.90 €");
  fireEvent.click(inMainButton("plans.want"));
  expect((await screen.findByRole("alert")).textContent).toBe(t("extra.auth_request_failed"));
  expect(screen.queryByRole("heading", { name: thanksTitle(world) })).toBeNull();
  expect(screen.queryByRole("button", { name: t("plans.want") })).toBeNull();
  expect(navigation.router.push).not.toHaveBeenCalledWith(sent);
  expect(calls(requests, "/plans")).toHaveLength(1);
  expect(calls(requests, "/subscription-requests")).toHaveLength(1);
});

// spec:test subscription-plans-request#treat-subscription-granted-administrator
// spec:test subscription-plans-request#return-plan-section-plan-free-current
test("uses side-effect-free account refreshes for a grant, another request, and expiry", async () => {
  let latest = world;
  const requests = serve(
    (path, request) => {
      if (path === "/plans" && request.method === "GET") return json(overview(world));
      throw new Error("Unexpected " + request.method + " " + path);
    },
    () => latest,
  );
  mount(profilePlans);

  await screen.findByText("8.90 €");
  expect(within(currentCard()).getByRole("heading", { name: t("plans.free") })).toBeDefined();
  expect(inMainButton("plans.want")).toBeDefined();
  latest = accountPlan(world, subscribed, now);
  refocus();

  await screen.findByText(t("plans.request_sent", { date: "26 November 2026" }));
  expect(
    within(currentCard()).getByRole("heading", { name: t("plans.subscription") }),
  ).toBeDefined();
  expect(screen.queryByRole("button", { name: t("plans.want") })).toBeNull();
  expect(calls(requests, "/plans")).toHaveLength(1);
  expect(calls(requests, "/subscription-requests")).toHaveLength(0);

  fireEvent.click(within(screen.getByRole("main")).getByRole("link", { name: t("extra.back") }));
  expect(await screen.findByText(t("plans.active_until", { date: "29 November" }))).toBeDefined();
  latest = accountPlan(world, free(4), now);
  refocus();
  expect(await screen.findByText(t("profile.plan_free", { N: 4 }))).toBeDefined();
  expect(calls(requests, "/plans")).toHaveLength(1);
  fireEvent.click(inMainButton("profile.plans_button"));
  await screen.findByText(t("plans.request_sent", { date: "26 November 2026" }));
  expect(within(currentCard()).getByRole("heading", { name: t("plans.free") })).toBeDefined();
  expect(calls(requests, "/plans")).toHaveLength(2);
  expect(calls(requests, "/plans/limit-hits")).toHaveLength(0);
});

test("resumes actual client creation if the limit check finds an existing stale cap", async () => {
  const requests = serve((path, request) => {
    if (path === "/plans/limit-hits" && request.method === "POST") return json(free(2));
    throw new Error("Unexpected " + request.method + " " + path);
  });
  mount(limit);

  expect(await screen.findByRole("textbox", { name: t("new.name") })).toBeDefined();
  expect(navigation.router.replace).toHaveBeenCalledExactlyOnceWith("/app/people/clients/new");
  expect(screen.queryByRole("heading", { name: t("limit.new_client") })).toBeNull();
  expect(calls(requests, "/plans/limit-hits")).toHaveLength(1);
  expect(calls(requests, "/plans")).toHaveLength(0);
});

test.each([limit, profilePlans, sent])(
  "redirects an unactivated account from %s before plan analytics",
  async (path) => {
    const requests = serve(
      (endpoint) => {
        throw new Error("Unexpected read " + endpoint);
      },
      () => ({ ...world, activated: false, activated_at: null, leader: null }),
    );
    mount(path);
    await waitFor(() => expect(navigation.router.replace).toHaveBeenCalledWith("/app/people"));
    expect(await screen.findByRole("heading", { name: t("people.title") })).toBeDefined();
    expect(calls(requests, "/plans")).toHaveLength(0);
    expect(calls(requests, "/plans/limit-hits")).toHaveLength(0);
    expect(calls(requests, "/subscription-requests")).toHaveLength(0);
  },
);

test("redirects a direct confirmation visit before the counted Plans request", async () => {
  const requests = serve((path, request) => {
    if (path === "/plans" && request.method === "GET") return json(overview(world));
    throw new Error("Unexpected " + request.method + " " + path);
  });
  mount(sent + "?email=forged@example.test");

  expect(await screen.findByText("8.90 €")).toBeDefined();
  expect(navigation.router.replace).toHaveBeenCalledWith(profilePlans);
  expect(screen.queryByText(/forged@example\.test/u)).toBeNull();
  expect(screen.queryByRole("heading", { name: thanksTitle(world) })).toBeNull();
  expect(calls(requests, "/plans").map(({ screen }) => screen)).toEqual(["/app/plans"]);
});

test("does not apply a completed request to the account that replaced it in this tab", async () => {
  const result = deferred<Response>();
  const replacement: Account = {
    ...world,
    id: "019ac7a0-0000-7ab1-b031-999999999999",
    email: "different@example.test",
  };
  const requests = serve(
    (path, request) => {
      if (path === "/plans" && request.method === "GET") {
        return json(
          overview(
            request.headers.get("authorization") === "Bearer " + rotatedToken ? replacement : world,
          ),
        );
      }
      if (path === "/subscription-requests" && request.method === "POST") return result.promise;
      throw new Error("Unexpected " + request.method + " " + path);
    },
    (session) => (session === rotatedToken ? replacement : world),
  );
  mount(profilePlans);
  await screen.findByText("8.90 €");
  fireEvent.click(inMainButton("plans.want"));
  await waitFor(() => expect(calls(requests, "/subscription-requests")).toHaveLength(1));

  act(() => setSessionToken(rotatedToken));
  await waitFor(() => expect(calls(requests, "/plans")).toHaveLength(2));
  await screen.findByText("8.90 €");
  await act(async () => result.resolve(json(receipt(), 201)));

  expect(calls(requests, "/subscription-requests")[0]?.request.signal.aborted).toBe(true);
  expect(navigation.router.push).not.toHaveBeenCalledWith(sent);
  expect(screen.queryByRole("heading", { name: thanksTitle(world) })).toBeNull();
  expect(screen.queryByRole("heading", { name: thanksTitle(replacement) })).toBeNull();
  expect(inMainButton("plans.want")).toBeDefined();
});

test("pauses plan refresh while Profile owns an editable draft", async () => {
  let latest = world;
  const requests = serve(
    (path) => {
      throw new Error("Unexpected read " + path);
    },
    () => latest,
  );
  mount(profile);

  await screen.findByText(t("profile.plan_free", { N: 3 }));
  fireEvent.click(screen.getByRole("button", { name: t("card.edit") }));
  const first = screen.getByRole("textbox", { name: t("signup.first_name") });
  fireEvent.change(first, { target: { value: "Unsaved Ada" } });
  latest = accountPlan(world, subscribed);
  const oldReads = calls(requests, "/account").length;
  await act(async () => window.dispatchEvent(new Event("focus")));

  expect(calls(requests, "/account")).toHaveLength(oldReads);
  expect(first).toHaveProperty("value", "Unsaved Ada");
  expect(screen.getByText(t("profile.plan_free", { N: 3 }))).toBeDefined();
  expect(calls(requests, "/plans")).toHaveLength(0);
});
