import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ComponentPropsWithoutRef, ReactElement } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { NoticeBar } from "@/components/NoticeBar";
import { useNavigationGuard } from "@/components/shell/navigation";
import { useAccount } from "@/lib/account";
import type { Schemas } from "@/lib/api/client";
import { t } from "@/lib/i18n";
import { getSessionToken, setSessionToken } from "@/lib/session";
import AppLayout from "./(app)/app/layout";
import Meetings from "./(app)/app/meetings/page";
import Notes from "./(app)/app/notes/page";
import AppHome from "./(app)/app/page";
import People from "./(app)/app/people/page";
import Records from "./(app)/app/records/page";

const navigation = vi.hoisted(() => ({
  router: { push: vi.fn(), replace: vi.fn() },
  pathname: "/app",
}));

vi.mock("next/navigation", () => ({
  useRouter: () => navigation.router,
  usePathname: () => navigation.pathname,
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
type Notice = Schemas["Notice"];

const token = "test-session";
const apiOrigin = "https://world-api.example.test";
const createdAt = "2026-11-14T12:00:00Z";

function accountFor(
  activated = false,
  language: Account["language"] = "en",
  timeZone: Account["time_zone"] = "UTC",
): Account {
  return {
    id: "019ac7a0-0000-7ab1-b031-111111111111",
    contour: "world",
    email: "ada@example.test",
    first_name: "Ada",
    last_name: "Lovelace",
    photo_url: null,
    phone: null,
    telegram: null,
    whatsapp: null,
    login: "adalovelace",
    address_url: "https://celmento.com/adalovelace",
    language,
    time_zone: timeZone,
    activated,
    activated_at: activated ? createdAt : null,
    leader: activated
      ? {
          specializations: [],
          specialization_other: null,
          about: "",
          contact_email: "ada@example.test",
          links: [],
          main_channel: null,
          booking_url: "https://celmento.com/adalovelace",
          working_hours: [],
          session_duration_minutes: 60,
          session_format: "online",
          default_meeting_link: null,
          default_rate: null,
          default_currency: "RUB",
          plan: { kind: "free", active_clients: 0, client_limit: 3, subscription_until: null },
        }
      : null,
    acceptances: [],
    created_at: createdAt,
  };
}

function json(content: unknown, status = 200): Response {
  return new Response(JSON.stringify(content), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function mockApi(respond: (request: Request) => Response | Promise<Response>): Request[] {
  const requests: Request[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (request: Request) => {
      requests.push(request.clone());
      return respond(request);
    }),
  );
  return requests;
}

function signIn(account: Account, notices: Notice[] = []): Request[] {
  setSessionToken(token);
  return mockApi((request) => {
    switch (new URL(request.url).pathname) {
      case "/api/v1/account":
        return json(account);
      case "/api/v1/notices":
        return json({ items: notices } satisfies Schemas["NoticeList"]);
      default:
        throw new Error(`Unexpected request: ${request.url}`);
    }
  });
}

function atPath(pathname: string, page: ReactElement): ReactElement {
  navigation.pathname = pathname;
  return <AppLayout>{page}</AppLayout>;
}

function menuLinks(menu: HTMLElement): (string | null)[] {
  return within(menu)
    .getAllByRole("link")
    .map((link) => link.getAttribute("href"));
}

function deferred<Value>(): { promise: Promise<Value>; resolve: (value: Value) => void } {
  let complete: (value: Value) => void = () => {
    throw new Error("Expected an initialized promise.");
  };
  const promise = new Promise<Value>((resolve) => {
    complete = resolve;
  });
  return { promise, resolve: complete };
}

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.lang = "en";
  navigation.pathname = "/app";
  navigation.router.push.mockReset();
  navigation.router.replace.mockReset();
  vi.stubEnv("NEXT_PUBLIC_CLM_APP_CONTOUR", "world");
  vi.stubEnv("NEXT_PUBLIC_CLM_APP_API_URL", apiOrigin);
  vi.spyOn(navigator, "language", "get").mockReturnValue("en-GB");
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

test("opens sign-in without fetching or displaying the protected shell when the token is absent", async () => {
  const requests = mockApi(() => {
    throw new Error("A token is required to load the account.");
  });
  render(atPath("/app", <AppHome />));

  await waitFor(() => expect(navigation.router.replace).toHaveBeenCalledWith("/login"));
  expect(requests).toHaveLength(0);
  expect(screen.queryByRole("navigation")).toBeNull();
});

test("clears a rejected token and returns to sign-in", async () => {
  setSessionToken(token);
  mockApi(() => json({ code: "unauthorized" }, 401));
  render(atPath("/app", <AppHome />));

  await waitFor(() => expect(navigation.router.replace).toHaveBeenCalledWith("/login"));
  expect(getSessionToken()).toBeNull();
  expect(screen.queryByRole("navigation")).toBeNull();
});

// spec:test mobile-app-shell#open-meetings-tab-leader-people
test.each([
  { activated: true, destination: "/app/meetings" },
  { activated: false, destination: "/app/people" },
])(
  "opens $destination on launch after reading the account's activation state",
  async ({ activated, destination }) => {
    const requests = signIn(accountFor(activated));
    render(atPath("/app", <AppHome />));

    await waitFor(() => expect(navigation.router.replace).toHaveBeenCalledWith(destination));
    expect(requests.map(({ url, method }) => [url, method])).toEqual([
      [apiOrigin + "/api/v1/account", "GET"],
    ]);
    expect(requests[0]?.headers.get("authorization")).toBe(`Bearer ${token}`);
    expect(getSessionToken()).toBe(token);
  },
);

test("offers a retry for an unavailable account response and keeps the session", async () => {
  setSessionToken(token);
  let fail = true;
  const requests = mockApi(() =>
    fail ? json({ code: "internal_error" }, 500) : json(accountFor()),
  );
  render(atPath("/app", <AppHome />));

  expect((await screen.findByRole("alert")).textContent).toBe(t("extra.auth_request_failed"));
  expect(screen.queryByRole("navigation")).toBeNull();
  expect(getSessionToken()).toBe(token);
  fail = false;
  fireEvent.click(screen.getByRole("button", { name: t("extra.auth_retry") }));
  await waitFor(() => expect(navigation.router.replace).toHaveBeenCalledWith("/app/people"));
  expect(requests).toHaveLength(2);
});

// spec:test mobile-app-shell#show-leader-one-bottom-menu
// spec:test mobile-app-shell#show-non-leader-bottom-menu-without-records
// spec:test mobile-app-shell#use-title-texts-people-tab
// spec:test client-leading-activation#show-non-leader-four-tabs-meetings
// spec:test mobile-app-shell#show-people-tab-leader-clients
// spec:test client-leading-activation#show-non-leader-people-tab-only-specialists
test.each([false, true])(
  "shows ordered tabs and only the permitted People sections (activated: %s)",
  async (activated) => {
    signIn(accountFor(activated));
    render(atPath("/app/people", <People />));

    const menu = await screen.findByRole("navigation", { name: t("extra.shell_navigation") });
    expect(menuLinks(menu)).toEqual([
      "/app/meetings",
      "/app/notes",
      "/app/people",
      ...(activated ? ["/app/records"] : []),
      "/app/profile",
    ]);
    expect(
      within(menu)
        .getByRole("link", { name: t("people.title") })
        .getAttribute("aria-current"),
    ).toBe("page");
    const subheadings = within(screen.getByRole("main")).getAllByRole("heading", { level: 2 });
    expect(subheadings.map((heading) => heading.textContent)).toEqual([
      ...(activated ? [t("clients.title")] : []),
      t("c.my_specialists"),
    ]);
    const create = within(menu).queryByRole("button", { name: t("clients.empty_add") });
    if (activated) {
      expect(create).toHaveProperty("disabled", true);
    } else {
      expect(create).toBeNull();
    }
  },
);

// spec:test mobile-app-shell#show-notes-account-meetings-people
// spec:test mobile-app-shell#show-records-profile-tabs-no-create
test.each([false, true])(
  "limits the create affordances to their tabs and activation state (activated: %s)",
  async (activated) => {
    signIn(accountFor(activated));
    const view = render(atPath("/app/notes", <Notes />));
    const menu = await screen.findByRole("navigation");
    const menuContent = within(menu);
    expect(menuContent.getByRole("button", { name: t("extra.note_create") })).toHaveProperty(
      "disabled",
      true,
    );

    view.rerender(atPath("/app/meetings", <Meetings />));
    const createMeeting = menuContent.queryByRole("button", { name: t("meetings.empty_day_cta") });
    if (activated) {
      expect(createMeeting).toHaveProperty("disabled", true);
    } else {
      expect(createMeeting).toBeNull();
    }

    view.rerender(atPath("/app/people", <People />));
    const createClient = menuContent.queryByRole("button", { name: t("clients.empty_add") });
    if (activated) {
      expect(createClient).toHaveProperty("disabled", true);
    } else {
      expect(createClient).toBeNull();
    }

    view.rerender(atPath("/app/records", <Records />));
    expect(menuContent.queryByRole("button")).toBeNull();
    if (activated) {
      expect(screen.getByRole("heading", { name: t("acc.title") })).toBeDefined();
    } else {
      expect(navigation.router.replace).toHaveBeenCalledWith("/app/people");
      expect(screen.queryByRole("heading", { name: t("acc.title") })).toBeNull();
    }

    view.rerender(atPath("/app/profile", <main />));
    expect(menuContent.queryByRole("button")).toBeNull();
  },
);

interface AccountUpdatesProps {
  updated: Account;
}

function AccountUpdates({ updated }: AccountUpdatesProps): ReactElement {
  const { refresh } = useAccount();
  return (
    <main>
      <button type="button" onClick={() => void refresh()}>
        Reload account
      </button>
      <button type="button" onClick={() => void refresh(updated)}>
        Apply saved account
      </button>
    </main>
  );
}

// spec:test mobile-app-shell#add-records-tab-bottom-menu
// spec:test mobile-app-shell#label-meetings-tab-bottom-menu
// spec:test schedule-date-navigation#label-meetings-tab-bottom-menu
test("applies a saved account immediately and keeps its language and zoned date when an older fetch resolves", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-15T22:00:00Z"));
  setSessionToken(token);
  const before = accountFor();
  const after = accountFor(true, "ru", "Europe/Moscow");
  const oldResponse = deferred<Response>();
  let fetches = 0;
  const requests = mockApi(() => (++fetches === 1 ? json(before) : oldResponse.promise));
  render(atPath("/app/profile", <AccountUpdates updated={after} />));

  const menu = await screen.findByRole("navigation", { name: "App sections" });
  expect(within(menu).getByRole("link", { name: "Sessions, 15 November" }).textContent).toBe(
    "15 November",
  );
  expect(within(menu).queryByRole("link", { name: "Records" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Reload account" }));
  fireEvent.click(screen.getByRole("button", { name: "Apply saved account" }));

  expect(within(menu).getByRole("link", { name: "Встречи, 16 ноября" }).textContent).toBe(
    "16 ноября",
  );
  expect(within(menu).getByRole("link", { name: "Учёт" }).getAttribute("href")).toBe(
    "/app/records",
  );
  expect(within(menu).getByRole("link", { name: "Профиль" }).getAttribute("aria-current")).toBe(
    "page",
  );
  expect(within(menu).getByRole("link", { name: "Люди" })).toBeDefined();
  expect(document.documentElement.lang).toBe("ru");
  expect(requests.map(({ method }) => method)).toEqual(["GET", "GET"]);
  expect(navigation.router.replace).not.toHaveBeenCalled();
  await act(async () => {
    oldResponse.resolve(json(before));
  });
  expect(within(menu).getByRole("link", { name: "Учёт" })).toBeDefined();
  expect(document.documentElement.lang).toBe("ru");
});

interface GuardedPageProps {
  confirm: (proceed: () => void) => void;
}

function GuardedPage({ confirm }: GuardedPageProps): ReactElement {
  useNavigationGuard(confirm);
  return <main />;
}

test("lets the dirty screen resume a bottom-menu transition only after confirmation", async () => {
  signIn(accountFor());
  const confirm = vi.fn<(proceed: () => void) => void>();
  render(atPath("/app/profile", <GuardedPage confirm={confirm} />));
  const menu = await screen.findByRole("navigation");

  fireEvent.click(within(menu).getByRole("link", { name: t("people.title") }));
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(navigation.router.push).not.toHaveBeenCalled();
  const proceed = confirm.mock.lastCall?.[0];
  expect(proceed).toBeTypeOf("function");
  proceed?.();
  expect(navigation.router.push).toHaveBeenCalledExactlyOnceWith("/app/people");
});

function historyTraversal(
  key: string,
  options: { info?: symbol; cancelable?: boolean; sameDocument?: boolean } = {},
): Event {
  return Object.assign(new Event("navigate", { cancelable: options.cancelable ?? true }), {
    navigationType: "traverse",
    info: options.info,
    destination: { key, sameDocument: options.sameDocument ?? true },
  });
}

test("pauses a cancellable history traversal and resumes its original native entry once", async () => {
  const browser = new EventTarget();
  const traverseTo = vi.fn((key: string, options: { info: symbol }) => {
    const resumed = historyTraversal(key, { info: options.info });
    expect(browser.dispatchEvent(resumed)).toBe(true);
    return { finished: Promise.resolve() };
  });
  vi.stubGlobal("navigation", Object.assign(browser, { traverseTo }));
  signIn(accountFor());
  const confirm = vi.fn<(proceed: () => void) => void>();
  render(atPath("/app/profile", <GuardedPage confirm={confirm} />));
  await screen.findByRole("navigation");

  expect(browser.dispatchEvent(historyTraversal("outside", { sameDocument: false }))).toBe(true);
  expect(browser.dispatchEvent(historyTraversal("locked", { cancelable: false }))).toBe(true);
  expect(confirm).not.toHaveBeenCalled();
  expect(browser.dispatchEvent(historyTraversal("people-history-entry"))).toBe(false);
  const proceed = confirm.mock.lastCall?.[0];
  expect(proceed).toBeTypeOf("function");
  proceed?.();
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(traverseTo).toHaveBeenCalledExactlyOnceWith("people-history-entry", {
    info: expect.any(Symbol),
  });
  expect(navigation.router.push).not.toHaveBeenCalled();
});

const rescheduled: Notice = {
  id: "rescheduled",
  tab: "meetings",
  key: "notify.rescheduled",
  created_at: "2026-11-16T14:00:00Z",
  params: {
    previous_starts_at: "2026-11-15T22:25:00Z",
    starts_at: "2026-11-17T06:40:00Z",
    specialist_name: "Анна",
  },
};

const cancelled: Notice = {
  id: "cancelled",
  tab: "meetings",
  key: "notify.cancelled",
  created_at: "2026-11-16T13:00:00Z",
  params: { starts_at: "2026-11-18T21:00:00Z" },
};

const archived: Notice = {
  id: "archived",
  tab: "people",
  key: "notify.archived_client_tried",
  created_at: "2026-11-16T12:00:00Z",
  params: { name: "Майя" },
};

// spec:test in-app-notice-bar#show-in-app-notification-bar-top
// spec:test in-app-notice-bar#show-notification-text-key-named
test("puts the current tab's notices above its content in API order and separates old and new zoned times", async () => {
  const entries = [rescheduled, cancelled, archived];
  const requests = signIn(accountFor(false, "ru", "Europe/Moscow"), entries);
  const view = render(atPath("/app/meetings", <Meetings />));
  const rescheduledText =
    "Встреча перенесена: было 16 ноября, 01:25 (Москва), стало 17 ноября, 09:40 (Москва)";
  const cancelledText = "Встреча 19 ноября, 00:00 (Москва) отменена и удалена из расписания";
  const bar = await screen.findByText(rescheduledText);
  const main = within(screen.getByRole("main"));
  expect(main.getAllByRole("listitem").map((item) => item.querySelector("p")?.textContent)).toEqual(
    [rescheduledText, cancelledText],
  );
  expect(
    bar.compareDocumentPosition(main.getByText(t("c.no_bookings", undefined, "ru"))) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  expect(main.queryByText("Майя из архива хотел записаться")).toBeNull();

  view.rerender(atPath("/app/people", <People />));
  expect(await screen.findByText("Майя из архива хотел записаться")).toBeDefined();
  expect(screen.queryByText(rescheduledText)).toBeNull();

  entries.splice(0, 1);
  view.rerender(atPath("/app/meetings", <Meetings />));
  expect(await screen.findByText(cancelledText)).toBeDefined();
  expect(screen.queryByText(rescheduledText)).toBeNull();
  const noticeRequests = requests.filter(
    (request) => request.url === apiOrigin + "/api/v1/notices",
  );
  expect(noticeRequests).toHaveLength(3);
  expect(
    noticeRequests.every((request) => request.headers.get("authorization") === `Bearer ${token}`),
  ).toBe(true);
});

test("shows the subscription end date as a civil date for an account west of UTC", async () => {
  signIn(accountFor(true, "en", "America/Los_Angeles"), [
    {
      id: "subscription",
      tab: "profile",
      key: "admin.access_granted",
      created_at: createdAt,
      params: { date: "2026-11-16" },
    },
  ]);
  render(
    atPath(
      "/app/profile",
      <main>
        <NoticeBar tab="profile" />
      </main>,
    ),
  );

  expect(await screen.findByText("You have full access until 16 November")).toBeDefined();
});

test("keeps a notice after a rejected dismissal and removes it after the server confirms", async () => {
  setSessionToken(token);
  let dismissals = 0;
  const requests = mockApi((request) => {
    if (request.url.endsWith("/account")) return json(accountFor(false, "ru"));
    if (request.url.endsWith("/notices")) return json({ items: dismissals < 2 ? [archived] : [] });
    if (++dismissals === 1) return json({ code: "internal_error" }, 500);
    return new Response(null, { status: 204 });
  });
  const view = render(atPath("/app/people", <People />));
  const noticeText = "Майя из архива хотел записаться";
  const close = await screen.findByRole("button", {
    name: t("extra.notice_dismiss", undefined, "ru"),
  });

  fireEvent.click(close);
  expect(await screen.findByRole("alert")).toBeDefined();
  expect(screen.getByText(noticeText)).toBeDefined();
  fireEvent.click(close);
  await waitFor(() => expect(screen.queryByText(noticeText)).toBeNull());
  expect(screen.queryByRole("alert")).toBeNull();
  const deletes = requests.filter(({ method }) => method === "DELETE");
  expect(deletes.map(({ url }) => url)).toEqual(
    Array<string>(2).fill(apiOrigin + "/api/v1/notices/archived"),
  );

  view.rerender(atPath("/app/notes", <Notes />));
  view.rerender(atPath("/app/people", <People />));
  await waitFor(() =>
    expect(requests.filter(({ url }) => url.endsWith("/notices"))).toHaveLength(2),
  );
  expect(screen.queryByText(noticeText)).toBeNull();
});

test("offers only the linked-card action and keeps that bar until the action succeeds", async () => {
  const linked: Notice = {
    id: "linked",
    tab: "people",
    key: "client.linked_notice",
    created_at: createdAt,
    params: { specialist_name: "Anna", specialist_id: "anna" },
  };
  const complete = deferred<void>();
  const unlink = vi.fn(() => complete.promise);
  const unused = vi.fn(async () => undefined);
  const requests = signIn(accountFor(), [archived, linked]);
  render(
    atPath(
      "/app/people",
      <main>
        <NoticeBar
          tab="people"
          actions={{ "client.linked_notice": unlink, "notify.archived_client_tried": unused }}
        />
      </main>,
    ),
  );

  const action = await screen.findByRole("button", { name: t("client.unlink") });
  const bars = screen.getAllByRole("listitem").filter((item) => item.querySelector("p"));
  expect(bars.map((bar) => within(bar).getAllByRole("button").length)).toEqual([1, 2]);
  fireEvent.click(action);
  expect(unlink).toHaveBeenCalledExactlyOnceWith(linked);
  expect(action).toHaveProperty("disabled", true);
  expect(screen.getByText(t("client.linked_notice", { Name: "Anna" }))).toBeDefined();

  await act(async () => {
    complete.resolve();
  });
  expect(screen.queryByRole("button", { name: t("client.unlink") })).toBeNull();
  expect(screen.getByText(t("notify.archived_client_tried", { name: "Майя" }))).toBeDefined();
  expect(unused).not.toHaveBeenCalled();
  expect(requests.filter(({ method }) => method === "DELETE")).toHaveLength(0);
});
