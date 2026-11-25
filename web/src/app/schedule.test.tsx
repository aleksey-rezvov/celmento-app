import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ComponentPropsWithoutRef, ReactElement } from "react";
import { afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import type { Schemas } from "@/lib/api/client";
import { t } from "@/lib/i18n";
import { saveView } from "@/lib/schedule-view";
import { setSessionToken } from "@/lib/session";
import { zonedClock, zonedDay, zonedInstant } from "@/lib/zoned-date";
import AppLayout from "./(app)/app/layout";
import NewMeetingPage from "./(app)/app/meetings/new/page";
import Meetings from "./(app)/app/meetings/page";
import PendingMeetings from "./(app)/app/meetings/pending/page";

const nav = vi.hoisted(() => ({
  router: { push: vi.fn(), replace: vi.fn() },
  pathname: "/app/meetings",
  query: "",
}));

vi.mock("next/navigation", () => ({
  useRouter: () => nav.router,
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(nav.query),
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
type Meeting = Schemas["Meeting"];

const token = "test-schedule-session";
const origin = "https://world-api.example.test";
const today = "2026-11-16";
const baseTime = "2026-11-15T22:15:00Z";
const zone = "Europe/Moscow";
const sessionId = "019ac7a0-0000-7ab1-b031-111111111111";
const mutualId = "019ac7a0-0000-7ab1-b031-222222222222";
const trainingId = "019ac7a0-0000-7ab1-b031-333333333333";
const archivedId = "019ac7a0-0000-7ab1-b031-444444444444";
const therapyId = "019ac7a0-0000-7ab1-b031-555555555555";
const attendee: NonNullable<Meeting["client"]> = {
  id: "019ac7a0-0000-7ab1-b031-777777777777",
  name: "Nora Silva",
  photo_url: null,
  archived: false,
  linked: true,
  time_zone: "Europe/Belgrade",
};

function accountFor(
  activated = true,
  language: Account["language"] = "en",
  timeZone = zone,
): Account {
  return {
    id: "019ac7a0-0000-7ab1-b031-888888888888",
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
    activated_at: activated ? baseTime : null,
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
          session_duration_minutes: 75,
          session_format: "online",
          default_meeting_link: null,
          default_rate: null,
          default_currency: "EUR",
          plan: { kind: "free", active_clients: 0, client_limit: 3, subscription_until: null },
        }
      : null,
    acceptances: [],
    created_at: baseTime,
  };
}

function meeting(id: string, startsAt: string, fields: Partial<Meeting> = {}): Meeting {
  return {
    id,
    type: "supervision",
    client: null,
    with_whom: "Lena",
    topic: null,
    starts_at: startsAt,
    duration_minutes: 60,
    actual_duration_minutes: null,
    place: "online",
    meeting_link: null,
    address: null,
    price: null,
    status: "scheduled",
    charged: null,
    comment: null,
    source: "specialist",
    client_comment: null,
    awaiting_outcome: false,
    created_at: baseTime,
    my_duration_minutes: null,
    payment_type: null,
    invite_url: null,
    ...fields,
  };
}

function json(result: unknown, status = 200): Response {
  return new Response(JSON.stringify(result), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function schedule(items: Meeting[] = [], count = 0, next: number | null = null): Response {
  return json({
    items,
    attended: [],
    pending_outcomes_count: count,
    next_outcome_in_seconds: next,
    attended_total: 0,
    specialists_count: 0,
  } satisfies Schemas["MeetingList"]);
}

function signedApi(
  respond: (request: Request, url: URL) => Response | Promise<Response>,
  account = accountFor(),
  notices: Schemas["Notice"][] = [],
): Request[] {
  setSessionToken(token);
  const requests: Request[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (request: Request) => {
      requests.push(request.clone());
      const url = new URL(request.url);
      if (url.pathname === "/api/v1/account") return json(account);
      if (url.pathname === "/api/v1/notices")
        return json({ items: notices } satisfies Schemas["NoticeList"]);
      return respond(request, url);
    }),
  );
  return requests;
}

function at(pathname: string, component: ReactElement): ReactElement {
  nav.pathname = pathname;
  return <AppLayout>{component}</AppLayout>;
}

function scheduleRanges(requests: Request[]): { from: string | null; to: string | null }[] {
  return requests
    .map(({ url }) => new URL(url))
    .filter((url) => url.pathname === "/api/v1/meetings")
    .map(({ searchParams }) => ({ from: searchParams.get("from"), to: searchParams.get("to") }));
}

function oneDay(day: string): { from: string; to: string } {
  return { from: day, to: day };
}

function setClock(instant: string): void {
  vi.setSystemTime(new Date(instant));
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
  nav.pathname = "/app/meetings";
  nav.query = "";
  nav.router.push.mockReset();
  nav.router.replace.mockReset();
  vi.stubEnv("NEXT_PUBLIC_CLM_APP_CONTOUR", "world");
  vi.stubEnv("NEXT_PUBLIC_CLM_APP_API_URL", origin);
  vi.useFakeTimers({ toFake: ["Date"] });
  setClock(baseTime);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

test("converts local wall times across midnight and resolves DST gaps and repeated hours", () => {
  expect(zonedDay(baseTime, zone)).toBe(today);
  expect(zonedClock(baseTime, zone)).toBe("01:15");
  expect(zonedInstant("2026-02-30", "14:00", zone)).toBeNull();
  expect(zonedInstant("2026-03-29", "02:30", "Europe/Belgrade")).toBeNull();
  expect(zonedInstant("2026-10-25", "02:30", "Europe/Belgrade")).toBe("2026-10-25T00:30:00.000Z");
  expect(zonedInstant(today, "09:00", zone)).toBe("2026-11-16T06:00:00.000Z");
});

// spec:test schedule-date-navigation#show-current-day-whenever-meetings
// spec:test schedule-date-navigation#open-tab-view-last-chosen
// spec:test schedule-date-navigation#show-title-header-meetings-tab
// spec:test schedule-date-navigation#show-header-date-subtitle-chevron
// spec:test schedule-day-view#return-current-day-today-tapped
test("defaults to today's feed, remembers Day, and reopens ordinarily on the account's today", async () => {
  const requests = signedApi(() => schedule());
  const first = render(at("/app/meetings", <Meetings />));
  expect(await screen.findByRole("heading", { name: t("meetings.title") })).toBeDefined();
  const switcher = within(screen.getByRole("group", { name: t("meetings.title") }));
  expect(
    switcher
      .getByRole("button", { name: t("meetings.view_schedule") })
      .getAttribute("aria-pressed"),
  ).toBe("true");
  expect(
    screen.getByRole("button", { name: t("meetings.today") }).getAttribute("aria-haspopup"),
  ).toBe("dialog");
  expect(await screen.findByText(t("meetings.today_empty"))).toBeDefined();
  expect(scheduleRanges(requests)[0]).toEqual({ from: "2026-11-02", to: "2026-11-30" });

  fireEvent.click(switcher.getByRole("button", { name: t("meetings.view_day") }));
  await screen.findByRole("region", { name: t("meetings.view_day") });
  expect(scheduleRanges(requests).at(-1)).toEqual(oneDay(today));
  fireEvent.click(screen.getByRole("button", { name: t("extra.schedule_next_day") }));
  expect(await screen.findByRole("button", { name: "17 November" })).toBeDefined();
  await waitFor(() => expect(scheduleRanges(requests).at(-1)).toEqual(oneDay("2026-11-17")));
  fireEvent.click(screen.getByRole("button", { name: t("meetings.today") }));
  await waitFor(() => expect(scheduleRanges(requests).at(-1)).toEqual(oneDay(today)));
  fireEvent.click(screen.getByRole("button", { name: t("extra.schedule_next_day") }));
  await screen.findByRole("button", { name: "17 November" });
  first.unmount();

  render(at("/app/meetings", <Meetings />));
  const dayView = await screen.findByRole("region", { name: t("meetings.view_day") });
  expect(dayView).toBeDefined();
  expect(
    screen.getByRole("button", { name: t("meetings.today") }).getAttribute("aria-haspopup"),
  ).toBe("dialog");
  expect(scheduleRanges(requests).at(-1)).toEqual(oneDay(today));
});

test("opens a valid saved meeting's local date and rejects an invalid return date", async () => {
  const selected = "2026-12-07";
  const meetings = [meeting(sessionId, "2026-12-06T22:30:00Z", { with_whom: "Saved appointment" })];
  const requests = signedApi((_request, url) =>
    schedule(url.searchParams.get("from") === selected ? meetings : []),
  );
  saveView("day");
  nav.query = `date=${selected}`;
  const view = render(at("/app/meetings", <Meetings />));
  expect(await screen.findByRole("button", { name: /Saved appointment/ })).toBeDefined();
  expect(screen.getByRole("button", { name: "7 December" })).toBeDefined();
  expect(scheduleRanges(requests).at(-1)).toEqual(oneDay(selected));
  const menu = within(screen.getByRole("navigation"));
  expect(menu.getByRole("link", { name: t("meetings.empty_day_cta") }).getAttribute("href")).toBe(
    `/app/meetings/new?date=${selected}`,
  );

  nav.query = "date=2026-02-31";
  view.rerender(at("/app/meetings", <Meetings />));
  await waitFor(() => expect(scheduleRanges(requests).at(-1)).toEqual(oneDay(today)));
  expect(
    screen.getByRole("button", { name: t("meetings.today") }).getAttribute("aria-haspopup"),
  ).toBe("dialog");
  expect(screen.queryByRole("button", { name: /Saved appointment/ })).toBeNull();

  nav.query = "";
  view.rerender(at("/app/meetings", <Meetings />));
  await screen.findByRole("region", { name: t("meetings.view_day") });
  expect(scheduleRanges(requests).at(-1)).toEqual(oneDay(today));
});

// spec:test meeting-form#open-screen-3-4-meetings-tab
test("prefills the actual form from the feed plus, the displayed Day, and an explicit hour", async () => {
  const selected = "2026-12-07";
  const requests = signedApi((_request, url) => {
    if (url.pathname.endsWith("/defaults")) {
      return json({
        starts_at: "2026-12-07T07:00:00Z",
        duration_minutes: 75,
        meeting_link: null,
        currency: "EUR",
      } satisfies Schemas["MeetingDefaults"]);
    }
    return schedule();
  });
  nav.query = `date=${selected}`;
  const view = render(at("/app/meetings", <Meetings />));
  const menu = within(await screen.findByRole("navigation"));
  const plus = menu.getByRole("link", { name: t("meetings.empty_day_cta") });
  expect(plus.getAttribute("href")).toBe(`/app/meetings/new?date=${today}`);
  fireEvent.click(
    within(screen.getByRole("group", { name: t("meetings.title") })).getByRole("button", {
      name: t("meetings.view_day"),
    }),
  );
  const region = await screen.findByRole("region", { name: t("meetings.view_day") });
  const dayHref = menu
    .getByRole("link", { name: t("meetings.empty_day_cta") })
    .getAttribute("href");
  expect(dayHref).toBe(`/app/meetings/new?date=${selected}`);
  const slot = within(region).getByRole("button", { name: `${t("form.start")} 15:00` });
  fireEvent.click(slot);
  fireEvent.click(within(region).getByRole("button", { name: t("meetings.create") }));
  const slotHref = nav.router.push.mock.lastCall?.[0];

  nav.query = new URL(String(dayHref), origin).search;
  view.rerender(at("/app/meetings/new", <NewMeetingPage />));
  expect(await screen.findByLabelText(t("form.date"))).toHaveProperty("value", selected);
  expect(screen.getByLabelText(t("form.start"))).toHaveProperty("value", "10:00");
  const defaults = requests.filter(({ url }) => url.includes("/meetings/defaults"));
  expect(defaults[0]?.url).toBe(`${origin}/api/v1/meetings/defaults?date=${selected}`);

  nav.query = new URL(String(slotHref), origin).search;
  view.rerender(at("/app/meetings/new", <NewMeetingPage />));
  await waitFor(() =>
    expect(screen.getByLabelText(t("form.start"))).toHaveProperty("value", "15:00"),
  );
  expect(screen.getByLabelText(t("form.date"))).toHaveProperty("value", selected);
  expect(requests.filter(({ url }) => url.includes("/meetings/defaults"))).toHaveLength(1);
});

// spec:test schedule-date-navigation#open-mini-month-calendar-month
// spec:test schedule-date-navigation#let-person-move-previous-next
// spec:test schedule-date-navigation#close-mini-calendar-open-picked
// spec:test schedule-date-navigation#close-mini-calendar-without-changing
// spec:test schedule-date-navigation#show-meetings-details-inside-mini
test("marks days in the month picker, dismisses without moving, and opens a chosen date in Day", async () => {
  const requests = signedApi((_request, url) => {
    if (url.pathname.endsWith("/calendar")) {
      const month = url.searchParams.get("month") ?? "";
      return json({
        month,
        days: month === "2026-11" ? [today] : [],
      } satisfies Schemas["MeetingCalendarMonth"]);
    }
    return schedule();
  });
  render(at("/app/meetings", <Meetings />));
  fireEvent.click(await screen.findByRole("button", { name: t("meetings.today") }));
  const dialog = within(await screen.findByRole("dialog", { name: t("extra.schedule_calendar") }));
  expect(dialog.getByText("November 2026")).toBeDefined();
  const current = await dialog.findByRole("button", { name: /16 November 2026, Sessions/u });
  expect(current.getAttribute("aria-current")).toBe("date");
  expect(current.querySelector(".schedule-calendar-dot")).not.toBeNull();
  fireEvent.click(dialog.getByRole("button", { name: t("extra.schedule_previous_month") }));
  expect(dialog.getByText("October 2026")).toBeDefined();
  await waitFor(() =>
    expect(requests.some(({ url }) => url.endsWith("/meetings/calendar?month=2026-10"))).toBe(true),
  );
  fireEvent.click(dialog.getByRole("button", { name: t("extra.close") }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByRole("button", { name: t("meetings.today") })).toBeDefined();

  fireEvent.click(screen.getByRole("button", { name: t("meetings.today") }));
  const reopened = within(
    await screen.findByRole("dialog", { name: t("extra.schedule_calendar") }),
  );
  expect(reopened.getByText("November 2026")).toBeDefined();
  fireEvent.click(reopened.getByRole("button", { name: t("extra.schedule_next_month") }));
  expect(reopened.getByText("December 2026")).toBeDefined();
  await waitFor(() =>
    expect(requests.some(({ url }) => url.endsWith("/meetings/calendar?month=2026-12"))).toBe(true),
  );
  fireEvent.click(reopened.getByRole("button", { name: /21 December 2026/u }));
  await screen.findByRole("region", { name: t("meetings.view_day") });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByRole("button", { name: "21 December" })).toBeDefined();
  expect(scheduleRanges(requests).at(-1)).toEqual(oneDay("2026-12-21"));
});

// spec:test schedule-date-navigation#switch-feed-day-view-switcher
// spec:test schedule-feed-view#show-screen-3-2-continuous-feed
// spec:test schedule-feed-view#open-feed-positioned-today-earlier
// spec:test schedule-feed-view#highlight-today-date-number-left
// spec:test schedule-feed-view#show-card-person-meeting-client
// spec:test schedule-feed-view#color-card-meeting-type-colors
// spec:test schedule-feed-view#show-card-status-marks-day
// spec:test schedule-feed-view#hide-day-without-meetings-feed
// spec:test schedule-feed-view#insert-separator-before-first-day
// spec:test schedule-feed-view#draw-current-time-line-inside-today
// spec:test schedule-feed-view#open-day-view-date-number
// spec:test time-zone-handling#show-leader-attendee-local-time
test("shows ordered local feed rows, pins today and switches back to the selected day", async () => {
  setClock("2026-11-16T10:20:00Z");
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    if (this.dataset.feedDay === today) return new DOMRect(0, 165, 350, 220);
    if (this.dataset.feedDay) return new DOMRect(0, 0, 350, 160);
    return new DOMRect(0, 0, 350, 500);
  });
  const earlier = meeting(trainingId, "2026-11-09T14:00:00Z", {
    type: "training",
    with_whom: "Earlier trainer",
  });
  const own = meeting(sessionId, "2026-11-16T06:30:00Z", {
    type: "client_session",
    client: attendee,
    status: "completed",
  });
  const mutual = meeting(mutualId, "2026-11-16T13:00:00Z", {
    type: "mutual_practice",
    with_whom: "Rene",
    place: "in_person",
    address: "Room 3",
  });
  const archived = meeting(archivedId, "2026-11-16T07:55:00Z", {
    type: "client_session",
    client: { ...attendee, name: "Former client", archived: true, linked: false },
    status: "not_taken_place",
  });
  const awaiting = meeting(therapyId, "2026-11-16T08:45:00Z", {
    type: "personal_therapy",
    with_whom: "Pat",
    awaiting_outcome: true,
  });
  const all = [mutual, earlier, archived, own, awaiting];
  const requests = signedApi((_request, url) => {
    const from = url.searchParams.get("from");
    return schedule(
      from === url.searchParams.get("to")
        ? all.filter((item) => zonedDay(item.starts_at, zone) === from)
        : all,
      1,
    );
  });
  render(at("/app/meetings", <Meetings />));
  const feed = await screen.findByRole("region", { name: t("meetings.view_schedule") });
  await within(feed).findByRole("button", { name: /Nora Silva/u });
  expect(feed.scrollTop).toBe(165);
  expect(
    [...feed.querySelectorAll<HTMLElement>("[data-feed-day]")].map((row) => row.dataset.feedDay),
  ).toEqual(["2026-11-09", today]);
  expect(
    within(feed)
      .getAllByRole("heading", { level: 2 })
      .map((heading) => heading.textContent),
  ).toEqual(["9–15 Nov", "16–22 Nov"]);

  const currentDate = within(feed).getByRole("button", { name: /16 November 2026/u });
  expect(currentDate.getAttribute("aria-current")).toBe("date");
  expect(currentDate.textContent).toContain("16");
  const ownCard = within(feed).getByRole("button", { name: /Nora Silva/u });
  expect(ownCard.textContent).toContain("09:30–10:30");
  expect(ownCard.textContent).toContain("client's time 07:30");
  expect(within(ownCard).getByRole("img", { name: t("outcome.done") })).toBeDefined();
  expect(ownCard.getAttribute("data-type")).toBe("client_session");
  const oldCard = within(feed).getByRole("button", { name: /Former client/u });
  expect(oldCard.getAttribute("data-archived")).toBe("true");
  expect(oldCard.querySelector("s")?.textContent).toBe("Former client");
  expect(oldCard.textContent).not.toContain("client's time");
  const therapyCard = within(feed).getByRole("button", { name: /Personal therapy · Pat/u });
  expect(within(therapyCard).getByText(t("meetings.need_outcome_badge"))).toBeDefined();
  const mutualCard = within(feed).getByRole("button", { name: /Mutual practice · Rene/u });
  expect(mutualCard.getAttribute("data-type")).toBe("mutual_practice");
  expect(within(mutualCard).getByText("Room 3")).toBeDefined();
  const row = mutualCard.closest("[data-feed-day]");
  expect(
    [...(row?.querySelectorAll(".schedule-meeting, .schedule-current-time") ?? [])].map(
      (element) =>
        element.classList.contains("schedule-current-time")
          ? "time"
          : element.querySelector(".schedule-meeting-name")?.textContent,
    ),
  ).toEqual([
    "Nora Silva✓",
    "Former client",
    "Personal therapy · Pat",
    "time",
    "Mutual practice · Rene",
  ]);
  fireEvent.click(mutualCard);
  expect(nav.router.push).toHaveBeenCalledWith(`/app/meetings/${mutualId}`);

  fireEvent.click(within(feed).getByRole("button", { name: /9 November 2026/u }));
  await screen.findByRole("region", { name: t("meetings.view_day") });
  expect(scheduleRanges(requests).at(-1)).toEqual(oneDay("2026-11-09"));
  expect(screen.getByRole("button", { name: "9 November" })).toBeDefined();
  fireEvent.click(
    within(screen.getByRole("group", { name: t("meetings.title") })).getByRole("button", {
      name: t("meetings.view_schedule"),
    }),
  );
  await screen.findByRole("button", { name: /Earlier trainer/u });
  expect(scheduleRanges(requests).at(-1)).toEqual({ from: "2026-10-26", to: "2026-11-23" });
  expect(screen.getByRole("button", { name: "9 November" })).toBeDefined();
});

// spec:test schedule-feed-view#load-earlier-days-person-scrolls
test("extends the feed in both directions as the viewport scrolls near an edge", async () => {
  const recent = meeting(sessionId, "2026-11-16T11:00:00Z", { with_whom: "Current" });
  const earlier = meeting(trainingId, "2026-10-20T10:00:00Z", { with_whom: "Earlier" });
  const later = meeting(mutualId, "2026-12-08T11:00:00Z", { with_whom: "Later" });
  const requests = signedApi((_request, url) => {
    const from = url.searchParams.get("from");
    return schedule(from === "2026-10-04" ? [earlier] : from === "2026-12-01" ? [later] : [recent]);
  });
  render(at("/app/meetings", <Meetings />));
  const feed = await screen.findByRole("region", { name: t("meetings.view_schedule") });
  await within(feed).findByRole("button", { name: /Current/u });
  Object.defineProperties(feed, { scrollHeight: { value: 1_000 }, clientHeight: { value: 320 } });

  fireEvent.scroll(feed, { target: { scrollTop: 320 } });
  fireEvent.scroll(feed, { target: { scrollTop: 40 } });
  expect(await within(feed).findByRole("button", { name: /Earlier/u })).toBeDefined();
  expect(scheduleRanges(requests).at(-1)).toEqual({ from: "2026-10-04", to: "2026-11-01" });
  fireEvent.scroll(feed, { target: { scrollTop: 660 } });
  expect(await within(feed).findByRole("button", { name: /Later/u })).toBeDefined();
  expect(scheduleRanges(requests).at(-1)).toEqual({ from: "2026-12-01", to: "2026-12-29" });
  expect(
    [...feed.querySelectorAll<HTMLElement>("[data-feed-day]")].map((row) => row.dataset.feedDay),
  ).toEqual(["2026-10-20", today, "2026-12-08"]);
});

// spec:test schedule-day-view#show-selected-day-screen-3-1
// spec:test schedule-day-view#position-scale-day-view-opens
// spec:test schedule-day-view#draw-red-current-time-line-scale
// spec:test schedule-day-view#show-block-start-end-time
// spec:test schedule-day-view#make-block-height-proportional-planned
// spec:test schedule-day-view#color-blocks-type-client-session
// spec:test schedule-day-view#mark-block-completed-meeting
// spec:test schedule-day-view#render-block-not-taken-place-meeting
// spec:test schedule-day-view#show-need-outcome-badge-block-meeting
// spec:test schedule-day-view#render-meeting-client-archived-grey
// spec:test schedule-day-view#move-next-day-swipe-left
// spec:test schedule-day-view#highlight-leader-taps-empty-hour
// spec:test schedule-day-view#open-meeting-form-date-start
// spec:test schedule-day-view#show-meeting-crosses-midnight-person
// spec:test schedule-day-view#draw-meeting-longer-8-hours
test("draws the day in the account zone and sends a tapped free hour as the correct instant", async () => {
  setClock("2026-11-16T07:20:00Z");
  vi.spyOn(Element.prototype, "scrollHeight", "get").mockReturnValue(1248);
  saveView("day");
  const completed = meeting(sessionId, "2026-11-16T06:00:00Z", {
    type: "client_session",
    client: attendee,
    status: "completed",
  });
  const long = meeting(trainingId, "2026-11-16T07:00:00Z", {
    type: "training",
    with_whom: "Workshop",
    duration_minutes: 540,
  });
  const cancelled = meeting(mutualId, "2026-11-16T16:15:00Z", {
    type: "mutual_practice",
    with_whom: "Former booking",
    status: "not_taken_place",
  });
  const crossing = meeting(archivedId, "2026-11-16T20:30:00Z", {
    type: "client_session",
    client: { ...attendee, name: "Archived appointment", archived: true },
    duration_minutes: 120,
  });
  const therapy = meeting(therapyId, "2026-11-16T04:00:00Z", {
    type: "personal_therapy",
    with_whom: "Pat",
    awaiting_outcome: true,
  });
  const requests = signedApi((_request, url) =>
    schedule(
      url.searchParams.get("from") === today ? [completed, long, cancelled, crossing, therapy] : [],
      1,
    ),
  );
  render(at("/app/meetings", <Meetings />));
  const region = await screen.findByRole("region", { name: t("meetings.view_day") });
  expect(region.scrollTop).toBe(520);
  expect(region.querySelectorAll(".schedule-hour-scale > *")).toHaveLength(24);
  expect(region.querySelector(".schedule-current-time time")?.textContent).toBe("10:20");
  const block = within(region).getByRole("button", { name: /Workshop/u });
  expect(block.getAttribute("data-type")).toBe("training");
  expect(block.textContent).toContain("10:00–19:00");
  expect(Number.parseFloat(block.style.height)).toBeCloseTo(37.5);
  const midnight = within(region).getByRole("button", { name: /Archived appointment/u });
  expect(midnight.getAttribute("data-archived")).toBe("true");
  expect(midnight.textContent).toContain("23:30–01:30");
  expect(Number.parseFloat(midnight.style.height)).toBeCloseTo(30 / 14.4);
  const client = within(region).getByRole("button", { name: /Nora Silva/u });
  expect(within(client).getByText("NS")).toBeDefined();
  expect(within(client).getByRole("img", { name: t("outcome.done") })).toBeDefined();
  expect(
    within(region)
      .getByRole("button", { name: /Former booking/u })
      .querySelector("s")?.textContent,
  ).toBe("Mutual practice · Former booking");
  expect(within(region).getByText(t("meetings.need_outcome_badge"))).toBeDefined();

  const hour = within(region).getByRole("button", { name: `${t("form.start")} 21:00` });
  fireEvent.click(hour);
  expect(hour.getAttribute("aria-pressed")).toBe("true");
  const selected = region.querySelector<HTMLElement>(".schedule-hour-selection");
  expect(Number.parseFloat(selected?.style.height ?? "")).toBeCloseTo(75 / 14.4);
  fireEvent.click(within(region).getByRole("button", { name: t("meetings.create") }));
  const href = nav.router.push.mock.lastCall?.[0];
  const destination = new URL(String(href), origin);
  expect(destination.pathname).toBe("/app/meetings/new");
  expect(destination.searchParams.get("date")).toBe(today);
  expect(destination.searchParams.get("starts_at")).toBe("2026-11-16T18:00:00.000Z");

  const swipeArea = region.closest(".schedule-day-view");
  if (!swipeArea) throw new Error("The day view is missing its touch surface.");
  fireEvent.touchStart(swipeArea, { touches: [{ clientX: 220, clientY: 140 }] });
  fireEvent.touchEnd(swipeArea, { changedTouches: [{ clientX: 95, clientY: 145 }] });
  const following = await screen.findByRole("region", { name: t("meetings.view_day") });
  expect(scheduleRanges(requests).at(-1)).toEqual(oneDay("2026-11-17"));
  expect(following.querySelector(".schedule-current-time")).toBeNull();
  expect(within(following).queryByRole("button", { name: /Archived appointment/u })).toBeNull();
  const returnArea = following.closest(".schedule-day-view");
  if (!returnArea) throw new Error("The day view is missing its touch surface.");
  fireEvent.touchStart(returnArea, { touches: [{ clientX: 90, clientY: 140 }] });
  fireEvent.touchEnd(returnArea, { changedTouches: [{ clientX: 230, clientY: 139 }] });
  expect(await screen.findByRole("button", { name: /Archived appointment/u })).toBeDefined();
  expect(scheduleRanges(requests).at(-1)).toEqual(oneDay(today));
});

// spec:test pending-outcomes#show-need-outcome-bar-n-equal-number
// spec:test pending-outcomes#open-screen-3-5-bar-tapped
// spec:test pending-outcomes#offer-control-dismiss-bar-separate
// spec:test in-app-notice-bar#keep-pending-outcomes-bar
test.each(["schedule", "day"] as const)(
  "revalidates the global pending count from an empty %s window",
  async (view) => {
    const selected = "2026-12-20";
    const timers = vi.spyOn(window, "setTimeout");
    let overdue = false;
    const notice: Schemas["Notice"] = {
      id: "019ac7a0-0000-7ab1-b031-666666666666",
      key: "notify.cancelled",
      tab: "meetings",
      created_at: baseTime,
      params: { starts_at: "2026-11-15T21:50:00Z" },
    };
    const requests = signedApi(
      () => (overdue ? schedule([], 1) : schedule([], 0, 120)),
      accountFor(),
      [notice],
    );
    saveView(view);
    nav.query = `date=${selected}`;
    render(at("/app/meetings", <Meetings />));
    await waitFor(() => expect(timers).toHaveBeenCalledWith(expect.any(Function), 120_000));
    const futureRange =
      view === "day" ? oneDay(selected) : { from: "2026-12-06", to: "2027-01-03" };
    expect(scheduleRanges(requests)).toEqual([futureRange]);
    expect(screen.queryByRole("link", { name: /Awaiting outcome/u })).toBeNull();

    overdue = true;
    const onMeetingEnd = timers.mock.calls.find(([, delay]) => delay === 120_000)?.[0];
    if (typeof onMeetingEnd !== "function")
      throw new Error("The server outcome deadline was not scheduled.");
    act(onMeetingEnd);
    const bar = await screen.findByRole("link", { name: t("meetings.need_outcome_bar", { N: 1 }) });
    expect(bar.getAttribute("href")).toBe("/app/meetings/pending");
    expect(scheduleRanges(requests)).toEqual([futureRange, futureRange]);
    const preceding = await screen.findByText(/Session on .* has been cancelled/u);
    expect(preceding.compareDocumentPosition(bar) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(within(bar).queryByRole("button")).toBeNull();
    expect(screen.getAllByRole("button", { name: t("extra.notice_dismiss") })).toHaveLength(1);
  },
);

// spec:test pending-outcomes#list-screen-3-5-meeting-awaiting
// spec:test pending-outcomes#show-done-missed-row-start
// spec:test pending-outcomes#open-meeting-card-row-tapped
test("orders pending rows oldest first, links to their outcome and saves mutual missed on click", async () => {
  setClock("2026-11-16T07:00:00Z");
  const early = meeting(mutualId, "2026-11-15T20:30:00Z", {
    type: "mutual_practice",
    with_whom: "Mira",
    awaiting_outcome: true,
  });
  const late = meeting(sessionId, "2026-11-15T22:15:00Z", {
    type: "client_session",
    client: attendee,
    awaiting_outcome: true,
  });
  const requests = signedApi((request, url) => {
    if (request.method === "PUT") {
      return json({
        ...early,
        status: "not_taken_place",
        awaiting_outcome: false,
        client_card: null,
        balance_charge: null,
      } satisfies Schemas["MeetingDetail"]);
    }
    if (url.pathname.endsWith("/pending-outcomes"))
      return json({
        items: [late, early],
        count: 2,
      } satisfies Schemas["MeetingPendingOutcomeList"]);
    throw new Error(`Unexpected request to ${url.pathname}`);
  });
  render(at("/app/meetings/pending", <PendingMeetings />));
  await screen.findByRole("heading", { name: t("meetings.need_outcome_bar", { N: 2 }) });
  const rows = within(screen.getByRole("main")).getAllByRole("listitem");
  expect(rows.map((row) => row.querySelector("strong")?.textContent)).toEqual([
    "Mutual practice · Mira",
    "Nora Silva",
  ]);
  const first = rows[0];
  const second = rows[1];
  if (!first || !second) throw new Error("Two pending rows are required.");
  const firstCard = within(first).getByRole("link", {
    name: /15 November · 23:30–00:30 Mutual practice · Mira/u,
  });
  expect(firstCard.getAttribute("href")).toBe(`/app/meetings/${mutualId}`);
  expect(
    within(first)
      .getByRole("link", { name: t("outcome.done") })
      .getAttribute("href"),
  ).toBe(`/app/meetings/${mutualId}/outcome?status=completed&from=pending`);
  expect(
    within(second)
      .getByRole("link", { name: t("outcome.missed") })
      .getAttribute("href"),
  ).toBe(`/app/meetings/${sessionId}/outcome?status=not_taken_place&from=pending`);
  expect(requests.some(({ method }) => method === "PUT")).toBe(false);

  fireEvent.click(within(first).getByRole("button", { name: t("outcome.missed") }));
  await screen.findByRole("heading", { name: t("meetings.need_outcome_bar", { N: 1 }) });
  expect(screen.queryByRole("link", { name: /Mutual practice · Mira/u })).toBeNull();
  const put = requests.find(({ method }) => method === "PUT");
  expect(put?.url).toBe(`${origin}/api/v1/meetings/${mutualId}/outcome`);
  expect(put?.headers.get("authorization")).toBe(`Bearer ${token}`);
  expect(await put?.json()).toEqual({ status: "not_taken_place" });
});

// spec:test pending-outcomes#show-list-empty-character
test("shows the pending empty state and leads back to the schedule", async () => {
  signedApi(() => json({ items: [], count: 0 } satisfies Schemas["MeetingPendingOutcomeList"]));
  render(at("/app/meetings/pending", <PendingMeetings />));

  const empty = await screen.findByText(t("meetings.need_outcome_empty"));
  expect(empty.parentElement?.querySelector("picture img")?.getAttribute("src")).toBe(
    "/characters/celmento-master-blue@200px.png",
  );
  expect(screen.getByRole("link", { name: t("extra.back") }).getAttribute("href")).toBe(
    "/app/meetings",
  );
});

// spec:test pending-outcomes#show-bar-badge-screen-3-5
// spec:test schedule-day-view#offer-non-leader-empty-hour-selection
test("shows no outcome or creation controls to an account without activation", async () => {
  const requests = signedApi((_request, url) => {
    throw new Error(`Unexpected request to ${url.pathname}`);
  }, accountFor(false));
  saveView("day");
  const view = render(at("/app/meetings", <Meetings />));
  expect(await screen.findByText(t("c.no_bookings"))).toBeDefined();
  expect(screen.queryByRole("link", { name: t("meetings.empty_day_cta") })).toBeNull();
  expect(
    screen.queryByRole("button", { name: (name) => name.startsWith(t("form.start") + " ") }),
  ).toBeNull();
  expect(screen.queryByText(t("meetings.need_outcome_badge"))).toBeNull();
  expect(screen.queryByRole("link", { name: /Awaiting outcome/u })).toBeNull();

  view.rerender(at("/app/meetings/pending", <PendingMeetings />));
  await waitFor(() => expect(nav.router.replace).toHaveBeenCalledWith("/app/meetings"));
  expect(requests.some(({ url }) => url.includes("/api/v1/meetings"))).toBe(false);
});
