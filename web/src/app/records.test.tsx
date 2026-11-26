import type { BoundFunctions, queries as domQueries } from "@testing-library/dom";
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
import type { ComponentPropsWithoutRef, ReactElement } from "react";
import { afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import type { Schemas } from "@/lib/api/client";
import { t } from "@/lib/i18n";
import { setSessionToken } from "@/lib/session";
import AppLayout from "./(app)/app/layout";
import Notes from "./(app)/app/notes/page";
import Balances from "./(app)/app/records/balances/page";
import HoursExport from "./(app)/app/records/hours/export/page";
import Hours from "./(app)/app/records/hours/page";
import RecordsLayout from "./(app)/app/records/layout";
import Operations from "./(app)/app/records/operations/page";
import RecordsSummaryPage from "./(app)/app/records/page";

const navigation = vi.hoisted(() => ({
  router: { push: vi.fn<(path: string) => void>(), replace: vi.fn<(path: string) => void>() },
  open: vi.fn<(path: string) => void>(),
  pathname: "/app/records",
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
        let prevented = false;
        onNavigate?.({
          preventDefault: () => {
            prevented = true;
          },
        });
        if (!prevented && href) navigation.open(href);
      }}
    />
  ),
}));

type Account = Schemas["Account"];
type Summary = Schemas["RecordsSummary"];
type Period = Schemas["RecordsPeriod"];
type Operation = Schemas["RecordsOperation"];
type HoursLog = Schemas["RecordsHoursLog"];
type HoursMeeting = Schemas["RecordsHoursMeeting"];
type Client = Schemas["ClientRef"];
type Balance = Schemas["RecordsBalanceItem"];

const apiOrigin = "https://world-api.example.test";
const token = "test-records-session";
const now = "2026-11-26T23:30:00Z";
const accountDay = "2026-11-27";
const recordsPath = "/app/records";
const incomePath = recordsPath + "/operations?kind=income";
const expensesPath = recordsPath + "/operations?kind=expenses";
const growthPath = recordsPath + "/hours?type=supervision";
const practicePath = recordsPath + "/hours?type=practice";
const hoursExportPath = recordsPath + "/hours/export";
const exportEndpoint = "/records/hours/export";
const goalEndpoint = "/records/hours/goal";
const balancesPath = recordsPath + "/balances";
const clientId = "019ac7a0-0000-7ab1-b031-111111111111";
const meetingId = "019ac7a0-0000-7ab1-b031-222222222222";

const account: Account = {
  id: "019ac7a0-0000-7ab1-b031-333333333333",
  contour: "world",
  email: "ada@example.test",
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
    default_rate: null,
    default_currency: "EUR",
    plan: { kind: "free", active_clients: 0, client_limit: 3, subscription_until: null },
  },
  acceptances: [],
  created_at: now,
};

const client: Client = {
  id: clientId,
  name: "Nora Silva",
  photo_url: null,
  archived: true,
  linked: false,
  time_zone: null,
};

function summary(changes: Partial<Summary> = {}): Summary {
  return {
    period: { kind: "all", from: null, to: null },
    has_outcomes: false,
    income: [],
    receipts: [],
    expenses: [],
    prepaid: [],
    debts: [],
    practice_hours: 0,
    completed_sessions: 0,
    growth_hours: 0,
    supervision_hours: 0,
    personal_therapy_hours: 0,
    training_hours: 0,
    ...changes,
  };
}

function operation(changes: Partial<Operation> = {}): Operation {
  return {
    id: "session-charge",
    kind: "session_charge",
    amount: { amount: "120.50", currency: "EUR" },
    date: "2026-11-25",
    meeting_id: meetingId,
    client,
    meeting_type: "client_session",
    with_whom: null,
    ...changes,
  };
}

function hourMeeting(changes: Partial<HoursMeeting> = {}): HoursMeeting {
  return {
    id: meetingId,
    date: "2026-11-25",
    client,
    with_whom: null,
    meeting_type: "client_session",
    hours: 2.5,
    payment_type: "barter",
    ...changes,
  };
}

function json(result: unknown, status = 200): Response {
  return new Response(JSON.stringify(result), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function serve(
  respond: (path: string, url: URL, request: Request) => Response | Promise<Response>,
  signedIn: Account = account,
  respondGoal?: (url: URL, request: Request) => Response | Promise<Response>,
): Request[] {
  setSessionToken(token);
  const requests: Request[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (request: Request) => {
      expect(request.headers.get("authorization")).toBe("Bearer " + token);
      requests.push(request.clone());
      const url = new URL(request.url);
      const path = url.pathname.replace(/^\/api\/v1/u, "");
      if (path === goalEndpoint && respondGoal) return respondGoal(url, request);
      expect(request.method).toBe("GET");
      switch (path) {
        case "/account":
          return json(signedIn);
        case "/folders":
          return json({ items: [] } satisfies Schemas["FolderList"]);
        case "/notes":
          return json({ items: [], total: 0 } satisfies Schemas["NoteList"]);
        case goalEndpoint:
          return json({ goal: null } satisfies Schemas["RecordsHoursGoalResult"]);
        default:
          return respond(path, url, request);
      }
    }),
  );
  return requests;
}

function queries(requests: readonly Request[], endpoint: string): Record<string, string>[] {
  return requests
    .map((request) => new URL(request.url))
    .filter((url) => url.pathname === "/api/v1" + endpoint)
    .map((url) => Object.fromEntries(url.searchParams.entries()));
}

function renderRoute(href: string): ReactElement {
  const url = new URL(href, apiOrigin);
  navigation.pathname = url.pathname;
  navigation.query = url.search;
  let records: ReactElement;
  switch (url.pathname) {
    case recordsPath:
      records = <RecordsSummaryPage />;
      break;
    case recordsPath + "/operations":
      records = <Operations />;
      break;
    case recordsPath + "/hours":
      records = <Hours />;
      break;
    case hoursExportPath:
      records = <HoursExport />;
      break;
    case balancesPath:
      records = <Balances />;
      break;
    case "/app/notes":
      return (
        <AppLayout>
          <Notes />
        </AppLayout>
      );
    default:
      throw new Error("Unexpected test route " + url.pathname);
  }
  return (
    <AppLayout>
      <RecordsLayout>{records}</RecordsLayout>
    </AppLayout>
  );
}

function mount(href: string = recordsPath): RenderResult {
  const view = render(renderRoute(href));
  navigation.open.mockImplementation((path) => view.rerender(renderRoute(path)));
  navigation.router.push.mockImplementation((path) => navigation.open(path));
  return view;
}

function recordsMain(): BoundFunctions<typeof domQueries> {
  return within(screen.getByRole("main"));
}

function tile(label: Parameters<typeof t>[0]): HTMLElement {
  const heading = recordsMain().getByRole("heading", { name: t(label) });
  const link = heading.closest("a");
  if (!link) throw new Error("The summary tile must open its detail screen.");
  return link;
}

function refocus(): void {
  act(() => window.dispatchEvent(new Event("focus")));
}

const emptyHours: HoursLog = {
  total_hours: 0,
  period_hours: 0,
  breakdown: { paid: 0, pro_bono: 0, individual: 0 },
  items: [],
};
const csvText = "\uFEFFDate,Client\r\n2026-11-08,Nora Silva\r\n";

function csv(filename: string): Response {
  return new Response(csvText, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="' + filename + '"',
    },
  });
}

function observeDownloads(): { create: ReturnType<typeof vi.fn>; filenames: string[] } {
  const create = vi.fn(() => "blob:https://localhost/records-spreadsheet");
  const filenames: string[] = [];
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = create;
      static revokeObjectURL = vi.fn();
    },
  );
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    filenames.push(this.download);
  });
  return { create, filenames };
}

function fileBytes(file: File): Promise<number[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) {
        resolve(Array.from(new Uint8Array(reader.result)));
      } else reject(new Error("No file bytes"));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
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

// spec:test records-hours-export#open-export
// spec:test records-hours-export#choose-period-format
test("opens export from all four logs and starts a separate all-time period", async () => {
  const requests = serve((path) => {
    if (path === "/records/summary") return json(summary({ has_outcomes: true }));
    if (path === "/records/hours") return json(emptyHours);
    if (path === exportEndpoint) return csv("celmento_training_all.csv");
    throw new Error("Unexpected read " + path);
  });
  mount();
  const period = await screen.findByRole("button", { name: t("acc.period_all") });
  fireEvent.click(period);
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", { name: t("acc.period_month") }),
  );
  await screen.findByRole("heading", { name: t("acc.practice_hours") });
  fireEvent.click(tile("acc.practice_hours"));
  const labels = [
    ["practice", "hours.practice"],
    ["supervision", "hours.supervision"],
    ["therapy", "hours.therapy"],
    ["training", "hours.training"],
  ] as const;
  for (const [type, label] of labels) {
    const tab = recordsMain().getByRole("button", { name: t(label) });
    fireEvent.click(tab);
    expect(recordsMain().getByRole("link", { name: t("export.button") })).toHaveProperty(
      "pathname",
      hoursExportPath,
    );
    expect(
      recordsMain()
        .getByRole("link", { name: t("export.button") })
        .getAttribute("href"),
    ).toBe(hoursExportPath + "?type=" + type);
  }
  fireEvent.click(recordsMain().getByRole("link", { name: t("export.button") }));
  expect(recordsMain().getByRole("button", { name: t("export.all_time") })).toBeDefined();
  expect(recordsMain().getByRole("heading", { name: t("hours.training") })).toBeDefined();
  expect(recordsMain().queryByRole("button", { name: t("export.icf") })).toBeNull();
  expect(recordsMain().queryByRole("button", { name: t("export.sessions") })).toBeNull();
  await waitFor(() =>
    expect(queries(requests, exportEndpoint)).toEqual([
      { type: "training", period: "all", format: "sessions" },
    ]),
  );
  fireEvent.click(recordsMain().getByRole("link", { name: t("extra.back") }));
  expect(recordsMain().getByText(t("acc.period_month"))).toBeDefined();
  expect(
    recordsMain()
      .getByRole("button", { name: t("hours.training") })
      .getAttribute("aria-pressed"),
  ).toBe("true");
});

// spec:test records-hours-export#choose-period-format
// spec:test records-hours-export#warn-before-export
// spec:test records-hours-export#share-or-download
test("warns before exporting and downloads the chosen practice period and format with the CSV bytes", async () => {
  const { create, filenames } = observeDownloads();
  const name = "celmento_practice_2026-11-01_2026-11-10.csv";
  const requests = serve((path, url) => {
    if (path !== exportEndpoint) throw new Error("Unexpected read " + path);
    return csv(url.searchParams.get("period") === "custom" ? name : "celmento_practice_all.csv");
  });
  mount(hoursExportPath + "?type=practice");
  const warning = await screen.findByText(t("export.warning"));
  const action = recordsMain().getByRole("button", { name: t("export.button") });
  expect(action.getAttribute("aria-describedby")).toBe(warning.id);
  expect(
    recordsMain()
      .getByRole("button", { name: t("export.icf") })
      .getAttribute("aria-pressed"),
  ).toBe("true");
  await waitFor(() => expect(action).toHaveProperty("disabled", false));
  expect(create).not.toHaveBeenCalled();

  fireEvent.click(recordsMain().getByRole("button", { name: t("export.sessions") }));
  fireEvent.click(recordsMain().getByRole("button", { name: t("export.all_time") }));
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", { name: t("acc.period_custom") }),
  );
  const range = within(screen.getByRole("dialog"));
  fireEvent.change(range.getByLabelText(t("extra.records_from")), {
    target: { value: "2026-11-01" },
  });
  fireEvent.change(range.getByLabelText(t("extra.records_to")), {
    target: { value: "2026-11-10" },
  });
  fireEvent.click(range.getByRole("button", { name: t("extra.records_apply") }));
  expect(action).toHaveProperty("disabled", true);
  await waitFor(() => expect(action).toHaveProperty("disabled", false));
  expect(queries(requests, exportEndpoint)).toEqual([
    { type: "practice", period: "all", format: "icf" },
    { type: "practice", period: "all", format: "sessions" },
    {
      type: "practice",
      period: "custom",
      from: "2026-11-01",
      to: "2026-11-10",
      format: "sessions",
    },
  ]);
  fireEvent.click(action);
  await waitFor(() => expect(filenames).toEqual([name]));
  const file: unknown = create.mock.calls[0]?.[0];
  expect(file).toBeInstanceOf(File);
  if (!(file instanceof File)) throw new Error("CSV download must receive the prepared file.");
  expect(await fileBytes(file)).toEqual(Array.from(new TextEncoder().encode(csvText)));
});

// spec:test records-hours-export#share-or-download
test("shares the prepared CSV directly and leaves cancellation free of a download", async () => {
  const { create } = observeDownloads();
  const name = "celmento_supervision_all.csv";
  const share = vi
    .fn<(data: ShareData) => Promise<void>>()
    .mockRejectedValue(new DOMException("Cancelled", "AbortError"));
  const canShare = vi.fn(() => true);
  vi.stubGlobal(
    "navigator",
    new Proxy(navigator, {
      get(target, property) {
        if (property === "share") return share;
        if (property === "canShare") return canShare;
        return Reflect.get(target, property, target);
      },
    }),
  );
  serve((path) => {
    if (path !== exportEndpoint) throw new Error("Unexpected read " + path);
    return csv(name);
  });
  mount(hoursExportPath + "?type=supervision");
  const action = await screen.findByRole("button", { name: t("export.button") });
  await waitFor(() => expect(action).toHaveProperty("disabled", false));
  fireEvent.click(action);
  expect(share).toHaveBeenCalledTimes(1);
  const file = share.mock.calls[0]?.[0].files?.[0];
  expect(file?.name).toBe(name);
  expect(file?.type).toBe("text/csv");
  expect(canShare).toHaveBeenCalledWith({ files: [file] });
  await waitFor(() => expect(action).toHaveProperty("disabled", false));
  expect(create).not.toHaveBeenCalled();
  expect(screen.queryByRole("alert")).toBeNull();
});

// spec:test accounting-summary#open-records-tab-screen-8-1
// spec:test accounting-summary#show-summary-zeros-curiosity-character
// spec:test accounting-summary#show-0-empty-tile-tile-no-data
// spec:test accounting-summary#compute-money-indicator-separately
// spec:test accounting-summary#reflect-recorded-changed-outcome-edited
// spec:test accounting-summary#show-prepaid-debts-tile-sum-positive
// spec:test accounting-summary#show-practice-hours-tile-practice-hours
// spec:test accounting-summary#show-growth-hours-tile-sum-supervision
test("shows all-time Records, preserves payments before the first outcome, and refreshes real figures", async () => {
  const receipts = [{ amount: "95.50", currency: "EUR" }] satisfies Schemas["Money"][];
  const prepaid = [{ amount: "1400", currency: "RUB" }] satisfies Schemas["Money"][];
  let data = summary({ receipts, prepaid });
  const requests = serve((path) => {
    if (path === "/records/summary") return json(data);
    throw new Error("Unexpected read " + path);
  });
  mount();

  const hero = await screen.findByText(t("acc.empty"));
  expect(hero.parentElement?.querySelector("picture img")?.getAttribute("src")).toBe(
    "/characters/celmento-master-blue@200px.png",
  );
  expect(recordsMain().getByRole("heading", { name: t("acc.title") })).toBeDefined();
  expect(recordsMain().getByRole("button", { name: t("acc.period_all") })).toBeDefined();
  expect(queries(requests, "/records/summary")).toEqual([{ period: "all" }]);
  expect(
    recordsMain()
      .getAllByRole("heading", { level: 2 })
      .map((heading) => heading.textContent),
  ).toEqual([
    t("acc.income"),
    t("acc.practice_hours"),
    t("acc.expenses"),
    t("acc.prepaid_debts"),
    t("acc.growth_hours"),
  ]);
  const income = within(tile("acc.income"));
  expect(income.getByText("0")).toBeDefined();
  expect(income.getByText("95.50 €")).toBeDefined();
  expect(income.getByText(t("acc.receipts"))).toBeDefined();
  expect(within(tile("acc.prepaid_debts")).getByText("1 400 ₽")).toBeDefined();
  expect(within(tile("acc.prepaid_debts")).getByText(t("acc.prepaid"))).toBeDefined();
  for (const label of ["acc.practice_hours", "acc.expenses", "acc.growth_hours"] as const) {
    const empty = within(tile(label));
    expect(empty.getByText("0")).toBeDefined();
    expect(empty.getByText(t("acc.empty_tile"))).toBeDefined();
  }

  data = summary({
    has_outcomes: true,
    receipts,
    prepaid,
    income: [
      { amount: "120000.00", currency: "RUB" },
      { amount: "800.25", currency: "EUR" },
    ],
    expenses: [{ amount: "-135.50", currency: "EUR" }],
    debts: [{ amount: "-22.75", currency: "USD" }],
    practice_hours: 2.5,
    completed_sessions: 2,
    growth_hours: 3.75,
    supervision_hours: 2,
    personal_therapy_hours: 1.5,
    training_hours: 0.25,
  });
  refocus();

  expect(await income.findByText("120 000 ₽ · 800.25 €")).toBeDefined();
  expect(within(tile("acc.expenses")).getByText("135.50 €")).toBeDefined();
  expect(within(tile("acc.prepaid_debts")).getByText("−22.75 $")).toBeDefined();
  expect(within(tile("acc.practice_hours")).getByText("2.50")).toBeDefined();
  expect(within(tile("acc.practice_hours")).getByText(t("acc.sessions", { N: 2 }))).toBeDefined();
  const growth = within(tile("acc.growth_hours"));
  expect(growth.getByText("3.75")).toBeDefined();
  expect(growth.getByText("Supervision 2.00 h")).toBeDefined();
  expect(growth.getByText("Therapy 1.50 h")).toBeDefined();
  expect(growth.getByText("Training 0.25 h")).toBeDefined();
  expect(recordsMain().queryByText(t("acc.empty"))).toBeNull();
  expect(
    recordsMain()
      .getAllByRole("button")
      .map((button) => button.textContent?.trim()),
  ).toEqual([t("acc.period_all") + " ⌄"]);
});

// spec:test accounting-summary#show-current-period-title-subtitle
// spec:test accounting-summary#interpret-period-year-current-calendar
// spec:test accounting-summary#recompute-tiles-chosen-period-soon
// spec:test accounting-summary#keep-chosen-period-leader-stays
// spec:test accounting-summary#open-operations-feed-income-filter
test("picks inclusive civil dates and keeps the period until leaving Records", async () => {
  const requests = serve((path, url) => {
    if (path === "/records/summary") {
      const selected = url.searchParams.get("period");
      const period: Period =
        selected === "custom"
          ? { kind: selected, from: url.searchParams.get("from"), to: url.searchParams.get("to") }
          : { kind: selected === "week" ? "week" : "all", from: null, to: null };
      return json(
        summary({
          has_outcomes: true,
          period,
          income: [
            {
              amount: selected === "custom" ? "29.50" : selected === "week" ? "72" : "100",
              currency: "EUR",
            },
          ],
          prepaid: [{ amount: "40", currency: "USD" }],
        }),
      );
    }
    if (path === "/records/operations")
      return json({ items: [] } satisfies Schemas["RecordsOperationList"]);
    throw new Error("Unexpected read " + path);
  });
  mount();

  await screen.findByText("100 €");
  fireEvent.click(recordsMain().getByRole("button", { name: t("acc.period_all") }));
  const picker = within(screen.getByRole("dialog"));
  expect(
    picker
      .getAllByRole("button")
      .filter((item) => item.hasAttribute("aria-pressed"))
      .map((item) => item.textContent),
  ).toEqual([
    t("acc.period_all"),
    t("acc.period_year"),
    t("acc.period_month"),
    t("acc.period_week"),
    t("acc.period_custom"),
  ]);
  fireEvent.click(picker.getByRole("button", { name: t("acc.period_week") }));
  expect(await screen.findByText("72 €")).toBeDefined();
  expect(recordsMain().getByRole("button", { name: t("acc.period_week") })).toBeDefined();
  expect(within(tile("acc.prepaid_debts")).getByText("40 $")).toBeDefined();

  fireEvent.click(recordsMain().getByRole("button", { name: t("acc.period_week") }));
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", { name: t("acc.period_custom") }),
  );
  const range = within(screen.getByRole("dialog", { name: t("acc.period_custom") }));
  const start = range.getByLabelText(t("extra.records_from"));
  const end = range.getByLabelText(t("extra.records_to"));
  const apply = range.getByRole("button", { name: t("extra.records_apply") });
  expect(start).toHaveProperty("value", accountDay);
  expect(end).toHaveProperty("value", accountDay);
  fireEvent.change(start, { target: { value: "2026-11-26" } });
  fireEvent.change(end, { target: { value: "2026-11-25" } });
  expect(apply).toHaveProperty("disabled", true);
  expect(queries(requests, "/records/summary")).toHaveLength(2);
  fireEvent.change(start, { target: { value: "2026-11-25" } });
  expect(apply).toHaveProperty("disabled", false);
  fireEvent.click(apply);

  await screen.findByText("29.50 €");
  const label = "25 November 2026 – 25 November 2026";
  expect(recordsMain().getByRole("button", { name: label })).toBeDefined();
  expect(within(tile("acc.prepaid_debts")).getByText("40 $")).toBeDefined();
  expect(queries(requests, "/records/summary")).toEqual([
    { period: "all" },
    { period: "week" },
    { period: "custom", from: "2026-11-25", to: "2026-11-25" },
  ]);

  expect(tile("acc.income").getAttribute("href")).toBe(incomePath);
  fireEvent.click(tile("acc.income"));
  await screen.findByText(t("acc.empty_tile"));
  expect(recordsMain().getByRole("heading", { name: t("feed.title") })).toBeDefined();
  expect(recordsMain().getByText(label)).toBeDefined();
  expect(recordsMain().queryByRole("button", { name: label })).toBeNull();
  expect(
    recordsMain()
      .getByRole("button", { name: t("acc.income") })
      .getAttribute("aria-pressed"),
  ).toBe("true");
  expect(queries(requests, "/records/operations")).toEqual([
    { period: "custom", from: "2026-11-25", to: "2026-11-25", kind: "income" },
  ]);

  fireEvent.click(recordsMain().getByRole("link", { name: t("extra.back") }));
  await screen.findByText("29.50 €");
  expect(recordsMain().getByRole("button", { name: label })).toBeDefined();
  const dock = within(screen.getByRole("navigation"));
  fireEvent.click(dock.getByRole("link", { name: t("notes.title") }));
  await screen.findByRole("heading", { name: t("notes.title") });
  fireEvent.click(dock.getByRole("link", { name: t("acc.title") }));
  await screen.findByText("100 €");
  expect(recordsMain().getByRole("button", { name: t("acc.period_all") })).toBeDefined();
  expect(queries(requests, "/records/summary").at(-1)).toEqual({ period: "all" });
});

// spec:test money-operations-feed#show-screen-8-2-titled-operations
// spec:test money-operations-feed#show-row-amount-sign-operation
// spec:test money-operations-feed#color-income-receipts-rows-green
// spec:test money-operations-feed#show-above-list-filters-all
// spec:test money-operations-feed#preselect-income-opened-income-tile
// spec:test money-operations-feed#open-meeting-card-meeting-row
// spec:test money-operations-feed#show-empty-state-empty-tile-sentence
// spec:test money-operations-feed#allow-editing-deleting-row-feed
test("navigates the real operations filters and signed source rows including zero expenses", async () => {
  const serviceId = "019ac7a0-0000-7ab1-b031-666666666666";
  const missedId = "019ac7a0-0000-7ab1-b031-777777777777";
  const charge = operation();
  const payment = operation({
    id: "receipt",
    kind: "payment",
    amount: { amount: "75", currency: "EUR" },
    date: "2026-11-26",
    meeting_id: null,
    meeting_type: null,
  });
  const missed = operation({
    id: "missed",
    kind: "missed_charge",
    amount: { amount: "23", currency: "USD" },
    date: "2026-11-24",
    meeting_id: missedId,
  });
  const expense = operation({
    id: "service",
    kind: "service_expense",
    amount: { amount: "0", currency: "EUR" },
    date: "2026-11-27",
    client: null,
    meeting_id: serviceId,
    meeting_type: "supervision",
    with_whom: "Asha",
  });
  let income = [charge, missed];
  const requests = serve((path, url) => {
    if (path === "/records/summary") {
      return json(
        summary({
          has_outcomes: true,
          expenses: [expense.amount],
          income: [charge.amount, missed.amount],
        }),
      );
    }
    if (path === "/records/operations") {
      const filter = url.searchParams.get("kind");
      const items =
        filter === "expenses"
          ? [expense]
          : filter === "income"
            ? income
            : filter === "receipts"
              ? [payment]
              : [expense, payment, ...income];
      return json({ items } satisfies Schemas["RecordsOperationList"]);
    }
    throw new Error("Unexpected read " + path);
  });
  mount();

  await screen.findByRole("heading", { name: t("acc.expenses") });
  expect(tile("acc.expenses").getAttribute("href")).toBe(expensesPath);
  fireEvent.click(tile("acc.expenses"));
  const service = await screen.findByRole("link", { name: /Supervision · Asha/u });
  expect(service.getAttribute("href")).toBe("/app/meetings/" + serviceId);
  const amount = within(service).getByText("− 0 €");
  expect(amount.getAttribute("data-expense")).toBe("true");
  expect(within(service).getByText("27 November 2026")).toBeDefined();
  expect(
    recordsMain()
      .getByRole("button", { name: t("acc.expenses") })
      .getAttribute("aria-pressed"),
  ).toBe("true");
  expect(service.querySelector(".records-row-description")?.textContent).not.toContain("Nora");

  const filterGroup = within(recordsMain().getByRole("group", { name: t("feed.title") }));
  expect(filterGroup.getAllByRole("button").map((button) => button.textContent)).toEqual([
    t("feed.all"),
    t("acc.income"),
    t("acc.receipts"),
    t("acc.expenses"),
  ]);
  fireEvent.click(filterGroup.getByRole("button", { name: t("feed.all") }));
  await screen.findByText("+ 120.50 €");
  const rows = recordsMain().getAllByRole("listitem");
  expect(recordsMain().getAllByRole("button")).toHaveLength(4);
  expect(rows.map((row) => row.querySelector("time")?.getAttribute("datetime"))).toEqual([
    "2026-11-27",
    "2026-11-26",
    "2026-11-25",
    "2026-11-24",
  ]);
  expect(rows.map((row) => row.querySelector("a")?.getAttribute("href"))).toEqual([
    "/app/meetings/" + serviceId,
    "/app/people/clients/" + clientId + "/balance",
    "/app/meetings/" + meetingId,
    "/app/meetings/" + missedId,
  ]);
  const clientCharge = recordsMain().getByRole("link", { name: /Session 25 November 2026/u });
  expect(within(clientCharge).getByText("+ 120.50 €").getAttribute("data-expense")).toBe("false");
  expect(within(clientCharge).getByText("Nora Silva")).toBeDefined();
  expect(within(clientCharge).getByText("NS")).toBeDefined();
  expect(recordsMain().getByText("Did not take place 24 November 2026")).toBeDefined();

  fireEvent.click(filterGroup.getByRole("button", { name: t("acc.receipts") }));
  const receipt = await screen.findByRole("link", { name: /Payment/u });
  expect(within(receipt).getByText("+ 75 €")).toBeDefined();
  expect(within(receipt).getByText("26 November 2026").getAttribute("datetime")).toBe("2026-11-26");
  expect(receipt.getAttribute("href")).toBe("/app/people/clients/" + clientId + "/balance");
  expect(recordsMain().queryByText("− 0 €")).toBeNull();
  fireEvent.click(filterGroup.getByRole("button", { name: t("acc.income") }));
  await screen.findByText("+ 120.50 €");
  income = [operation({ amount: { amount: "180", currency: "EUR" } })];
  refocus();
  expect(await screen.findByText("+ 180 €")).toBeDefined();
  expect(recordsMain().queryByText("+ 120.50 €")).toBeNull();
  expect(recordsMain().queryByText("+ 23 $")).toBeNull();

  income = [];
  refocus();
  expect(await screen.findByText(t("acc.empty_tile"))).toBeDefined();
  expect(
    recordsMain()
      .getByRole("link", { name: t("meetings.title") })
      .getAttribute("href"),
  ).toBe("/app/meetings");
  expect(screen.getByRole("main").querySelector("picture")).toBeNull();
  expect(queries(requests, "/records/operations").map(({ kind }) => kind)).toEqual([
    "expenses",
    "all",
    "receipts",
    "income",
    "income",
    "income",
  ]);
});

// spec:test accounting-summary#open-hours-log-practice-tab
// spec:test hours-log#show-screen-8-3-titled-tabs
// spec:test hours-log#show-total-large-type-log
// spec:test hours-log#show-period-next-total-log
// spec:test hours-log#show-totals-breakdown-chosen-period
// spec:test hours-log#list-below-breakdown-log-meetings
// spec:test hours-log#open-meeting-card-listed-meeting
// spec:test hours-log#keep-hours-archived-clients-totals
// spec:test hours-log#update-totals-breakdown-list-immediately
// spec:test hours-log#show-empty-tile-sentence-one-button
// spec:test hours-log#offer-editing-meeting-hours-log
test("opens the requested hours log with current and total hours and refreshes the selected rows", async () => {
  const mutualId = "019ac7a0-0000-7ab1-b031-888888888888";
  const barter = hourMeeting();
  const mutual = hourMeeting({
    id: mutualId,
    client: null,
    meeting_type: "mutual_practice",
    with_whom: "Meera",
    payment_type: null,
    hours: 0.75,
    date: "2026-11-26",
  });
  let updated = false;
  const requests = serve((path, url) => {
    if (path === "/records/summary") return json(summary({ has_outcomes: true }));
    if (path === "/records/hours") {
      const type = url.searchParams.get("type");
      const list: HoursLog = {
        total_hours:
          type === "supervision" ? 81.5 : type === "practice" ? (updated ? 18.25 : 20.75) : 0,
        period_hours:
          type === "supervision" ? 2 : type === "practice" ? (updated ? 0.75 : 3.25) : 0,
        breakdown:
          type === "practice"
            ? { paid: updated ? 0 : 2.5, pro_bono: 0.75, individual: updated ? 0.75 : 3.25 }
            : { paid: null, pro_bono: null, individual: type === "supervision" ? 2 : 0 },
        items:
          type === "practice"
            ? updated
              ? [mutual]
              : [mutual, barter]
            : type === "supervision"
              ? [
                  hourMeeting({
                    meeting_type: "supervision",
                    client: null,
                    with_whom: "Asha",
                    hours: 2,
                    payment_type: null,
                  }),
                ]
              : [],
      };
      return json(list);
    }
    throw new Error("Unexpected read " + path);
  });
  mount();

  await screen.findByRole("heading", { name: t("acc.growth_hours") });
  fireEvent.click(recordsMain().getByRole("button", { name: t("acc.period_all") }));
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", { name: t("acc.period_month") }),
  );
  expect(await screen.findByRole("heading", { name: t("acc.growth_hours") })).toBeDefined();
  expect(tile("acc.growth_hours").getAttribute("href")).toBe(growthPath);
  fireEvent.click(tile("acc.growth_hours"));
  const tabs = within(await screen.findByRole("group", { name: t("hours.title") }));
  expect(tabs.getAllByRole("button").map((button) => button.textContent)).toEqual([
    t("hours.practice"),
    t("hours.supervision"),
    t("hours.therapy"),
    t("hours.training"),
  ]);
  expect(
    tabs.getByRole("button", { name: t("hours.supervision") }).getAttribute("aria-pressed"),
  ).toBe("true");
  expect(await screen.findByText(t("hours.total", { H: "81.50" }))).toBeDefined();
  expect(recordsMain().getByText(t("hours.period", { H: "2.00" }))).toBeDefined();
  expect(recordsMain().getByText(t("hours.individual"))).toBeDefined();
  expect(recordsMain().queryByText(t("hours.paid"))).toBeNull();
  expect(recordsMain().queryByText(t("hours.pro_bono"))).toBeNull();
  expect(recordsMain().getByRole("link", { name: /Asha/u }).getAttribute("href")).toBe(
    "/app/meetings/" + meetingId,
  );

  fireEvent.click(recordsMain().getByRole("link", { name: t("extra.back") }));
  await screen.findByRole("heading", { name: t("acc.practice_hours") });
  expect(tile("acc.practice_hours").getAttribute("href")).toBe(practicePath);
  fireEvent.click(tile("acc.practice_hours"));
  const archived = await screen.findByRole("link", { name: /Nora Silva/u });
  expect(archived.getAttribute("href")).toBe("/app/meetings/" + meetingId);
  expect(within(archived).getByText(t("form.barter"))).toBeDefined();
  expect(within(archived).getByText("25 November 2026")).toBeDefined();
  expect(within(archived).getByText("2.50 h")).toBeDefined();
  const mutualLink = recordsMain().getByRole("link", { name: /Mutual practice · Meera/u });
  expect(mutualLink.getAttribute("href")).toBe("/app/meetings/" + mutualId);
  expect(within(mutualLink).getByText(t("form.pro_bono"))).toBeDefined();
  expect(within(mutualLink).getByText("0.75 h")).toBeDefined();
  expect(recordsMain().getByText(t("hours.period", { H: "3.25" }))).toBeDefined();
  const breakdown = screen.getByRole("main").querySelector<HTMLElement>("dl");
  if (!breakdown) throw new Error("Expected the selected log's breakdown.");
  expect([...breakdown.querySelectorAll("div")].map((row) => row.textContent)).toEqual([
    t("hours.paid") + "2.50 h",
    t("hours.pro_bono") + "0.75 h",
    t("hours.individual") + "3.25 h",
  ]);
  expect(
    recordsMain()
      .getAllByRole("listitem")
      .map((row) => row.querySelector("a")?.getAttribute("href")),
  ).toEqual(["/app/meetings/" + mutualId, "/app/meetings/" + meetingId]);

  updated = true;
  refocus();
  expect(await screen.findByText(t("hours.total", { H: "18.25" }))).toBeDefined();
  expect(recordsMain().getByText(t("hours.period", { H: "0.75" }))).toBeDefined();
  expect(recordsMain().queryByRole("link", { name: /Nora Silva/u })).toBeNull();
  expect(within(breakdown).getByText("0.00 h")).toBeDefined();
  const currentTabs = within(recordsMain().getByRole("group", { name: t("hours.title") }));
  fireEvent.click(currentTabs.getByRole("button", { name: t("hours.therapy") }));
  expect(await screen.findByText(t("acc.empty_tile"))).toBeDefined();
  expect(
    recordsMain()
      .getByRole("link", { name: t("meetings.title") })
      .getAttribute("href"),
  ).toBe("/app/meetings");
  expect(screen.getByRole("main").querySelector("picture")).toBeNull();
  await screen.findByRole("button", { name: t("goal.set") });
  expect(recordsMain().getAllByRole("button")).toHaveLength(5);
  expect(queries(requests, "/records/hours")).toEqual([
    { period: "month", type: "supervision" },
    { period: "month", type: "practice" },
    { period: "month", type: "practice" },
    { period: "month", type: "therapy" },
  ]);
});

test("uses all-time totals without a redundant current-period number on a direct hours link", async () => {
  const requests = serve((path) => {
    if (path === "/records/hours") {
      return json({
        total_hours: 46.75,
        period_hours: 46.75,
        breakdown: { paid: null, pro_bono: null, individual: 46.75 },
        items: [],
      } satisfies HoursLog);
    }
    throw new Error("Unexpected read " + path);
  });
  mount(recordsPath + "/hours?type=training");

  expect(await screen.findByText(t("hours.total", { H: "46.75" }))).toBeDefined();
  expect(recordsMain().queryByText(t("hours.period", { H: "46.75" }))).toBeNull();
  expect(
    recordsMain()
      .getByRole("button", { name: t("hours.training") })
      .getAttribute("aria-pressed"),
  ).toBe("true");
  expect(queries(requests, "/records/hours")).toEqual([{ period: "all", type: "training" }]);
});

// spec:test records-hours-goal#open-edit-delete
test("creates, edits, and removes a goal only in the selected hours log", async () => {
  let goal: Schemas["RecordsHoursGoal"] | null = null;
  const requests = serve(
    (path) => {
      if (path === "/records/hours") return json(emptyHours);
      throw new Error("Unexpected read " + path);
    },
    account,
    async (url, request) => {
      if (request.method === "GET")
        return json({ goal: url.searchParams.get("type") === "practice" ? goal : null });
      expect(Object.fromEntries(url.searchParams)).toEqual({ type: "practice" });
      if (request.method === "PUT") {
        goal = (await request.json()) as Schemas["RecordsHoursGoal"];
        return json({ goal });
      }
      expect(request.method).toBe("DELETE");
      goal = null;
      return new Response(null, { status: 204 });
    },
  );
  mount(practicePath);

  fireEvent.click(await screen.findByRole("button", { name: t("goal.set") }));
  const create = within(screen.getByRole("dialog", { name: t("goal.set") }));
  expect(create.queryByRole("button", { name: t("card.delete") })).toBeNull();
  const save = create.getByRole("button", { name: t("form.save") });
  const label = create.getByLabelText(t("goal.label"));
  expect(label).toHaveProperty("placeholder", t("goal.label_hint"));
  fireEvent.change(label, { target: { value: "  PCC practice  " } });
  fireEvent.change(create.getByLabelText(t("goal.hours")), { target: { value: "0" } });
  expect(save).toHaveProperty("disabled", true);
  fireEvent.change(create.getByLabelText(t("goal.hours")), { target: { value: "4,75" } });
  fireEvent.click(save);
  await screen.findByRole("heading", { name: "PCC practice" });
  expect(screen.queryByRole("dialog")).toBeNull();

  fireEvent.click(recordsMain().getByRole("button", { name: t("hours.supervision") }));
  await screen.findByRole("button", { name: t("goal.set") });
  expect(screen.queryByRole("heading", { name: "PCC practice" })).toBeNull();
  const practice = recordsMain().getByRole("button", { name: t("hours.practice") });
  fireEvent.click(practice);
  await screen.findByRole("heading", { name: "PCC practice" });
  fireEvent.click(recordsMain().getByRole("button", { name: t("card.edit") }));
  const edit = within(screen.getByRole("dialog", { name: t("card.edit") }));
  expect(edit.getByLabelText(t("goal.hours"))).toHaveProperty("value", "4.75");
  expect(edit.getByLabelText(t("goal.label"))).toHaveProperty("value", "PCC practice");
  fireEvent.change(edit.getByLabelText(t("goal.hours")), { target: { value: "10" } });
  fireEvent.change(edit.getByLabelText(t("goal.label")), { target: { value: "Renewal" } });
  fireEvent.click(edit.getByRole("button", { name: t("form.save") }));
  await screen.findByRole("heading", { name: "Renewal" });

  fireEvent.click(recordsMain().getByRole("button", { name: t("card.edit") }));
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", { name: t("card.delete") }),
  );
  const confirmation = within(screen.getByRole("dialog", { name: t("card.delete") }));
  expect(confirmation.getByText(t("extra.records_goal_delete_effect"))).toBeDefined();
  expect(requests.some(({ method }) => method === "DELETE")).toBe(false);
  fireEvent.click(confirmation.getByRole("button", { name: t("archive.cancel") }));
  fireEvent.click(
    within(screen.getByRole("dialog", { name: t("card.edit") })).getByRole("button", {
      name: t("card.delete"),
    }),
  );
  fireEvent.click(
    within(screen.getByRole("dialog", { name: t("card.delete") })).getByRole("button", {
      name: t("card.delete"),
    }),
  );
  await screen.findByRole("button", { name: t("goal.set") });
  expect(screen.queryByRole("heading", { name: "Renewal" })).toBeNull();
  expect(practice.getAttribute("aria-pressed")).toBe("true");
  expect(queries(requests, goalEndpoint)).toEqual([
    { type: "practice" },
    { type: "practice" },
    { type: "supervision" },
    { type: "practice" },
    { type: "practice" },
    { type: "practice" },
  ]);
  const writes = requests.filter(({ method }) => method !== "GET");
  expect(writes.map(({ method }) => method)).toEqual(["PUT", "PUT", "DELETE"]);
  await expect(writes[0]?.json()).resolves.toEqual({ hours: "4.75", label: "PCC practice" });
  await expect(writes[1]?.json()).resolves.toEqual({ hours: "10", label: "Renewal" });
});

// spec:test records-hours-goal#show-goal-progress
test("shows progress and completed goals based on all-time hours with a selected period", async () => {
  let totalHours = 4.25;
  const requests = serve(
    (path) => {
      if (path === "/records/summary") return json(summary({ has_outcomes: true }));
      if (path === "/records/hours")
        return json({ ...emptyHours, total_hours: totalHours, period_hours: 1.25 });
      throw new Error("Unexpected read " + path);
    },
    account,
    () => json({ goal: { hours: "10.75", label: "PCC practice" } }),
  );
  mount();
  fireEvent.click(await screen.findByRole("button", { name: t("acc.period_all") }));
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", { name: t("acc.period_month") }),
  );
  await screen.findByRole("heading", { name: t("acc.practice_hours") });
  fireEvent.click(tile("acc.practice_hours"));

  const progress = t("goal.progress", { H: "4.25", goal: "10.75" });
  const meter = await screen.findByRole("progressbar", { name: progress });
  expect(meter).toHaveProperty("value", 4.25);
  expect(meter).toHaveProperty("max", 10.75);
  expect(recordsMain().getByText(progress)).toBeDefined();
  expect(recordsMain().getByText(t("goal.left", { H: "6.50" }))).toBeDefined();
  expect(recordsMain().getByText(t("hours.period", { H: "1.25" }))).toBeDefined();
  expect(recordsMain().getByText(t("acc.period_month"))).toBeDefined();
  expect(queries(requests, "/records/hours")).toEqual([{ period: "month", type: "practice" }]);
  expect(queries(requests, goalEndpoint)).toEqual([{ type: "practice" }]);

  totalHours = 1234.5;
  refocus();
  expect(await screen.findByText(t("goal.reached"))).toBeDefined();
  expect(recordsMain().getByText(t("goal.left", { H: "0.00" }))).toBeDefined();
  expect(meter).toHaveProperty("value", 10.75);
  expect(
    recordsMain().getByText(t("goal.progress", { H: "1 234.50", goal: "10.75" })),
  ).toBeDefined();
  expect(recordsMain().getByText(t("hours.period", { H: "1.25" }))).toBeDefined();
});

// spec:test accounting-summary#open-prepaid-debts-tile-screen-title
// spec:test accounting-summary#show-row-balances-list-client
test("keeps server-ordered active and archived balances and reuses the rated-client badges", async () => {
  const items: Balance[] = [
    {
      client,
      balance: {
        balance: { amount: "-300", currency: "EUR" },
        sessions_left: null,
        unpaid_sessions: "1.5",
      },
    },
    {
      client: { ...client, id: "unrated", name: "No set rate", archived: false },
      balance: {
        balance: { amount: "-25.50", currency: "USD" },
        sessions_left: null,
        unpaid_sessions: null,
      },
    },
    {
      client: { ...client, id: "prepaid", name: "Meera Kapoor", archived: false },
      balance: {
        balance: { amount: "24000", currency: "RUB" },
        sessions_left: "2",
        unpaid_sessions: null,
      },
    },
  ];
  let cleared = false;
  const requests = serve((path) => {
    if (path === "/records/summary") {
      const prepaid = items[2]?.balance.balance;
      if (!prepaid) throw new Error("A prepayment is required.");
      return json(
        summary({
          prepaid: [prepaid],
          debts: items.slice(0, 2).map((item) => item.balance.balance),
        }),
      );
    }
    if (path === "/records/balances")
      return json({ items: cleared ? [] : items } satisfies Schemas["RecordsBalanceList"]);
    throw new Error("Unexpected read " + path);
  });
  mount();

  await screen.findByRole("heading", { name: t("acc.prepaid_debts") });
  fireEvent.click(recordsMain().getByRole("button", { name: t("acc.period_all") }));
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", { name: t("acc.period_year") }),
  );
  expect(await screen.findByRole("heading", { name: t("acc.prepaid_debts") })).toBeDefined();
  expect(tile("acc.prepaid_debts").getAttribute("href")).toBe(balancesPath);
  fireEvent.click(tile("acc.prepaid_debts"));
  const debtor = await screen.findByRole("link", { name: "Nora Silva" });
  expect(debtor.getAttribute("href")).toBe("/app/people/clients/" + clientId);
  expect(recordsMain().getByRole("heading", { name: t("balances.title") })).toBeDefined();
  const rows = recordsMain().getAllByRole("listitem");
  expect(rows.map((row) => row.querySelector("a")?.textContent)).toEqual([
    "Nora Silva",
    "No set rate",
    "Meera Kapoor",
  ]);
  expect(rows.map((row) => row.querySelector(".client-row-detail > span")?.textContent)).toEqual([
    "−300 €",
    "−25.50 $",
    "24 000 ₽",
  ]);
  expect(rows[0]?.getAttribute("data-archived")).toBe("true");
  expect(rows[0]?.querySelector(".client-balance-debt")?.textContent).toBe(
    t("clients.balance_debt", { N: "1.5" }),
  );
  expect(rows[1]?.querySelector(".client-balance-badge")).toBeNull();
  expect(rows[2]?.querySelector(".client-balance-credit")?.textContent).toBe(
    t("clients.balance_plus", { N: "2" }),
  );
  expect(queries(requests, "/records/balances")).toEqual([{}]);

  cleared = true;
  refocus();
  expect(await screen.findByText(t("extra.records_no_balances"))).toBeDefined();
  expect(recordsMain().queryByRole("link", { name: "Nora Silva" })).toBeNull();
  expect(screen.getByRole("main").querySelector("picture")).toBeNull();
});

test("reports a failed summary read and retries with the selected account and period", async () => {
  let reads = 0;
  const requests = serve((path) => {
    if (path === "/records/summary") {
      return ++reads === 1 ? json({ code: "internal_error" }, 503) : json(summary());
    }
    throw new Error("Unexpected read " + path);
  });
  mount();

  expect((await screen.findByRole("alert")).textContent).toBe(t("extra.auth_request_failed"));
  expect(recordsMain().queryByRole("heading", { name: t("acc.income") })).toBeNull();
  fireEvent.click(recordsMain().getByRole("button", { name: t("extra.auth_retry") }));
  expect(await screen.findByRole("heading", { name: t("acc.income") })).toBeDefined();
  expect(recordsMain().queryByRole("alert")).toBeNull();
  expect(queries(requests, "/records/summary")).toEqual([{ period: "all" }, { period: "all" }]);
});

test.each([incomePath, practicePath, balancesPath])(
  "rejects a non-leader deep link to %s before fetching Records",
  async (path) => {
    const requests = serve(
      (endpoint) => {
        throw new Error("Unexpected read " + endpoint);
      },
      { ...account, activated: false, activated_at: null, leader: null },
    );
    mount(path);
    await waitFor(() => expect(navigation.router.replace).toHaveBeenCalledWith("/app/people"));
    expect(requests.some(({ url }) => new URL(url).pathname.startsWith("/api/v1/records"))).toBe(
      false,
    );
    expect(screen.queryByRole("main")).toBeNull();
  },
);

test("does not render a superseded period when its response arrives after the current one", async () => {
  let finishWeek: (response: Response) => void = () => {
    throw new Error("The delayed response fixture has not been initialized.");
  };
  const delayed = new Promise<Response>((resolve) => {
    finishWeek = resolve;
  });
  const observed: { week?: Request } = {};
  serve((path, url, request) => {
    if (path !== "/records/summary") throw new Error("Unexpected read " + path);

    const period = url.searchParams.get("period");
    if (period === "week") {
      observed.week = request;
      return delayed;
    }
    return json(
      summary({
        has_outcomes: true,
        income: [{ amount: period === "month" ? "70" : "90", currency: "EUR" }],
      }),
    );
  });
  mount();

  await screen.findByText("90 €");
  fireEvent.click(recordsMain().getByRole("button", { name: t("acc.period_all") }));
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", { name: t("acc.period_week") }),
  );
  await waitFor(() => expect(observed.week).toBeDefined());
  fireEvent.click(recordsMain().getByRole("button", { name: t("acc.period_week") }));
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", { name: t("acc.period_month") }),
  );
  await screen.findByText("70 €");
  expect(observed.week?.signal.aborted).toBe(true);

  await act(async () => {
    finishWeek(json(summary({ income: [{ amount: "45", currency: "EUR" }] })));
  });
  expect(recordsMain().getByText("70 €")).toBeDefined();
  expect(recordsMain().queryByText("45 €")).toBeNull();
  expect(recordsMain().getByRole("button", { name: t("acc.period_month") })).toBeDefined();
});

// spec:test accounting-summary#offer-manual-entry-hours-income
test("keeps financial amounts and hours read-only across all Records screens", async () => {
  const example = { amount: "40", currency: "EUR" } satisfies Schemas["Money"];
  const requests = serve((path) => {
    switch (path) {
      case "/records/summary":
        return json(
          summary({
            has_outcomes: true,
            income: [example],
            prepaid: [example],
            practice_hours: 2.5,
            completed_sessions: 1,
          }),
        );
      case "/records/operations":
        return json({
          items: [operation({ amount: example })],
        } satisfies Schemas["RecordsOperationList"]);
      case "/records/hours":
        return json({
          total_hours: 2.5,
          period_hours: 2.5,
          breakdown: { paid: 2.5, pro_bono: 0, individual: 2.5 },
          items: [hourMeeting()],
        } satisfies HoursLog);
      case "/records/balances":
        return json({
          items: [
            { client, balance: { balance: example, sessions_left: "1", unpaid_sessions: null } },
          ],
        } satisfies Schemas["RecordsBalanceList"]);
      default:
        throw new Error("Unexpected read " + path);
    }
  });

  function expectControls(buttons: string[]): void {
    const main = screen.getByRole("main");
    expect(main.querySelector("form, input, textarea, select, [contenteditable]")).toBeNull();
    expect(
      within(main)
        .queryAllByRole("button")
        .map(({ textContent }) => textContent?.trim()),
    ).toEqual(buttons);
  }

  mount();
  await screen.findByRole("heading", { name: t("acc.income") });
  expectControls([t("acc.period_all") + " ⌄"]);
  fireEvent.click(recordsMain().getByRole("button", { name: t("acc.period_all") }));
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", { name: t("acc.period_custom") }),
  );
  const range = screen.getByRole("dialog", { name: t("acc.period_custom") });
  expect([...range.querySelectorAll("input")].map((input) => input.type)).toEqual(["date", "date"]);
  expect(range.querySelector("textarea, select, [contenteditable]")).toBeNull();
  fireEvent.click(within(range).getByRole("button", { name: t("extra.close") }));

  fireEvent.click(tile("acc.income"));
  await screen.findByText("+ 40 €");
  expectControls([t("feed.all"), t("acc.income"), t("acc.receipts"), t("acc.expenses")]);
  fireEvent.click(recordsMain().getByRole("link", { name: t("extra.back") }));

  await screen.findByRole("heading", { name: t("acc.practice_hours") });
  fireEvent.click(tile("acc.practice_hours"));
  await screen.findByText(t("hours.total", { H: "2.50" }));
  await screen.findByRole("button", { name: t("goal.set") });
  expectControls([
    t("hours.practice"),
    t("hours.supervision"),
    t("hours.therapy"),
    t("hours.training"),
    t("goal.set"),
  ]);
  fireEvent.click(recordsMain().getByRole("link", { name: t("extra.back") }));

  await screen.findByRole("heading", { name: t("acc.prepaid_debts") });
  fireEvent.click(tile("acc.prepaid_debts"));
  await screen.findByRole("link", { name: client.name });
  expectControls([]);
  expect(new Set(requests.map(({ method }) => method))).toEqual(new Set(["GET"]));
});
