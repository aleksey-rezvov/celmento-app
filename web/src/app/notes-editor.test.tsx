import { webcrypto } from "node:crypto";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import ClientCardPage from "./(app)/app/people/clients/[id]/page";
import MeetingPage from "./(app)/app/meetings/[id]/page";
import MoveNotePage from "./(app)/app/notes/[id]/move/page";
import NotePage from "./(app)/app/notes/[id]/page";
import TagNotePage from "./(app)/app/notes/[id]/tag/page";
import NewNotePage from "./(app)/app/notes/new/page";
import { AppNavigationProvider } from "@/components/shell/navigation";
import { AccountProvider } from "@/lib/account";
import type { Schemas } from "@/lib/api/client";
import { formatDate } from "@/lib/format";
import { t, type MessageKey } from "@/lib/i18n/messages";
import { noteTitle, parseNoteText, toShareText, toggleAuthorItem } from "@/lib/note-text";
import { setSessionToken } from "@/lib/session";

const ids = {
  owner: "00000000-0000-4000-8000-000000000001",
  author: "00000000-0000-4000-8000-000000000002",
  note: "00000000-0000-4000-8000-000000000003",
  reply: "00000000-0000-4000-8000-000000000004",
  folder: "00000000-0000-4000-8000-000000000005",
  meeting: "00000000-0000-4000-8000-000000000006",
  standalone: "00000000-0000-4000-8000-000000000007",
  linked: "00000000-0000-4000-8000-000000000008",
  tag: "00000000-0000-4000-8000-000000000009",
};
const api = "https://notes.example.test";
const address = "https://celmento.com/adalovelace";
const created = "2026-07-10T13:00:00.000Z";
const modified = "2026-07-11T13:00:00.000Z";
const timeZone = "Europe/Belgrade";
const newHref = "/app/notes/new";
const noteHref = "/app/notes/" + ids.note;
const noteApi = "/notes/" + ids.note;
const token = "notes-editor-session";

const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), id: "" }));
vi.mock("next/navigation", () => ({
  useRouter: () => nav,
  useParams: () => ({ id: nav.id }),
  useSearchParams: () => new URLSearchParams(window.location.search),
  usePathname: () => window.location.pathname,
}));

type Note = Schemas["Note"];
type Update = Schemas["NoteUpdate"];
type Card = Schemas["ClientCard"];
type Detail = Schemas["MeetingDetail"];
type Person = Schemas["NoteTaggablePerson"];

function owner(leader: boolean): Schemas["Account"] {
  return {
    id: ids.owner,
    contour: "world",
    email: "owner@example.test",
    first_name: "Ada",
    last_name: "Lovelace",
    photo_url: null,
    phone: null,
    telegram: null,
    whatsapp: null,
    login: "adalovelace",
    address_url: address,
    language: "en",
    time_zone: timeZone,
    activated: leader,
    activated_at: leader ? created : null,
    leader: leader
      ? {
          specializations: [],
          specialization_other: null,
          about: "",
          contact_email: null,
          links: [],
          main_channel: null,
          booking_url: address,
          working_hours: [],
          session_duration_minutes: 45,
          session_format: "online",
          default_meeting_link: null,
          default_rate: "75",
          default_currency: "USD",
          plan: { kind: "free", active_clients: 1, client_limit: 3, subscription_until: null },
        }
      : null,
    acceptances: [],
    created_at: created,
  };
}

function note(overrides: Partial<Note> = {}): Note {
  return {
    id: ids.note,
    author: { id: ids.owner, name: "Ada Lovelace", photo_url: null },
    title: "Session record",
    text: "Original note text",
    folder_id: null,
    tags: [],
    shared_with_me: false,
    can_edit: true,
    checked_items: [],
    created_at: created,
    updated_at: created,
    ...overrides,
  };
}

function received(overrides: Partial<Note> = {}): Note {
  return note({
    author: { id: ids.author, name: "Grace Hopper", photo_url: null },
    can_edit: false,
    shared_with_me: true,
    ...overrides,
  });
}

function card(): Card {
  return {
    id: ids.linked,
    name: "Private client name",
    photo_url: null,
    phone: null,
    email: null,
    telegram: null,
    whatsapp: null,
    other_contact: null,
    preferred_channel: null,
    rate: "25.50",
    currency: "EUR",
    request: "Never copy this request",
    goals: "Never copy this goal",
    info: "Never copy this note",
    hypotheses: null,
    status: "active",
    archived_at: null,
    linked: false,
    is_new: false,
    source: "created",
    completed_sessions: 0,
    completed_hours: 0,
    balance: {
      balance: { amount: "0", currency: "EUR" },
      sessions_left: null,
      unpaid_sessions: null,
    },
    created_at: created,
    self_given_email: null,
    link: { status: "standalone", method: null, login: null },
    payment_type: "paid",
  };
}

function meeting(): Detail {
  return {
    id: ids.meeting,
    type: "training",
    client: null,
    with_whom: "Private trainer name",
    topic: "Observation",
    starts_at: created,
    duration_minutes: 45,
    my_duration_minutes: null,
    actual_duration_minutes: null,
    place: "online",
    meeting_link: null,
    address: null,
    price: { amount: "0", currency: "USD" },
    status: "scheduled",
    charged: null,
    comment: "Sensitive comment stays in the meeting",
    source: "specialist",
    client_comment: null,
    awaiting_outcome: true,
    created_at: created,
    payment_type: null,
    invite_url: null,
    client_card: null,
    balance_charge: null,
  };
}

function tag(overrides: Partial<Schemas["NoteTag"]> = {}): Schemas["NoteTag"] {
  return {
    id: ids.tag,
    target_kind: "client_card",
    target_id: ids.linked,
    name: "Client in note",
    photo_url: null,
    linked: true,
    archived: false,
    created_at: created,
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

function setup(handle?: Handler, options: { leader?: boolean; note?: Note } = {}): Request[] {
  const requests: Request[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (request: Request): Promise<Response> => {
      const url = new URL(request.url);
      if (url.origin !== api) throw new Error("Unexpected request host.");
      const path = url.pathname.replace(/^\/api\/v1/u, "");
      requests.push(request.clone());
      if (request.headers.get("Authorization") !== "Bearer " + token)
        throw new Error("Missing session.");
      const overridden = await handle?.(request, path);
      if (overridden) return overridden;
      if (request.method === "GET") {
        if (path === "/account") return json(owner(options.leader ?? true));
        if (path === noteApi) return json(options.note ?? note());
        if (path === "/meetings/" + ids.meeting) return json(meeting());
        if (path === "/clients/" + ids.linked) return json(card());
        if (path === "/clients/" + ids.linked + "/meetings")
          return json({ upcoming: [], past: [] });
        if (path === "/clients/" + ids.linked + "/notes" || path === "/notices")
          return json({ items: [] });
        if (path === "/folders")
          return json({
            items: [{ id: ids.folder, name: "Practice", color: "blue", created_at: created }],
          });
      }
      throw new Error("Unexpected request " + request.method + " " + path);
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

function setRoute(path: string, id = ids.note): void {
  nav.id = id;
  window.history.replaceState(null, "", path);
}

function button(key: MessageKey): HTMLElement {
  return screen.getByRole("button", { name: t(key) });
}

function edit(key: "note.title_placeholder" | "note.text_placeholder", value: string): void {
  fireEvent.change(screen.getByRole("textbox", { name: t(key) }), { target: { value } });
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => {
    throw new Error("Promise was not initialized.");
  };
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
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
  setSessionToken(token);
  setRoute(newHref);
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  window.history.replaceState(null, "", "/");
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

// spec:test note-editor#open-empty-note-screen-7-2
// spec:test note-editor#keep-note-closed-empty-title
test.each([true, false])(
  "opens an empty focused editor for leader=%s and closes without creating a row",
  async (leader) => {
    const requests = setup(undefined, { leader });
    render(view(<NewNotePage />));
    const title = await screen.findByRole("textbox", { name: t("note.title_placeholder") });
    expect(title).toHaveProperty("value", "");
    expect(title.getAttribute("placeholder")).toBe(t("note.title_placeholder"));
    expect(document.activeElement).toBe(title);
    expect(
      screen.getByRole("textbox", { name: t("note.text_placeholder") }).getAttribute("placeholder"),
    ).toBe(t("note.text_placeholder"));
    fireEvent.click(button("extra.close"));
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/app/notes"));
    expect(calls(requests, "POST", "/notes")).toHaveLength(0);
  },
);

// spec:test note-editor#open-existing-note-account-screen
// spec:test note-editor#save-note-automatically-user-types
test("autosaves only edited fields and rebases returned fields without dropping newer input", async () => {
  setRoute(noteHref);
  const first = deferred<Response>();
  const second = deferred<Response>();
  const patches: Update[] = [];
  setup(async (request, path) => {
    if (path !== noteApi || request.method !== "PATCH") return;
    const patch = (await request.json()) as Update;
    patches.push(patch);
    if (patches.length === 1) return first.promise;
    if (patches.length === 2) return second.promise;
    return json(note({ title: "Newest title", text: patch.text, updated_at: modified }));
  });
  render(view(<NotePage />));
  expect(await screen.findByRole("textbox", { name: t("note.title_placeholder") })).toHaveProperty(
    "value",
    "Session record",
  );
  expect(screen.queryByRole("button", { name: t("form.save") })).toBeNull();
  expect(screen.getByText("Original note text")).toBeTruthy();

  edit("note.title_placeholder", "First title");
  expect(screen.getByText(t("note.saving"))).toBeTruthy();
  await waitFor(() => expect(patches).toEqual([{ title: "First title" }]));
  edit("note.title_placeholder", "Newest title");
  expect(patches).toHaveLength(1);
  await act(async () =>
    first.resolve(json(note({ title: "First title", text: "Remote text", updated_at: modified }))),
  );
  await waitFor(() =>
    expect(patches).toEqual([{ title: "First title" }, { title: "Newest title" }]),
  );
  expect(screen.getByRole("textbox", { name: t("note.title_placeholder") })).toHaveProperty(
    "value",
    "Newest title",
  );
  fireEvent.click(screen.getByText("Remote text"));
  await screen.findByRole("textbox", { name: t("note.text_placeholder") });
  edit("note.text_placeholder", "Newer local body");
  await act(async () =>
    second.resolve(
      json(note({ title: "Newest title", text: "New remote text", updated_at: modified })),
    ),
  );
  expect(await screen.findByText(t("note.saved"))).toBeTruthy();
  expect(patches).toEqual([
    { title: "First title" },
    { title: "Newest title" },
    { text: "Newer local body" },
  ]);
  expect(screen.getByRole("textbox", { name: t("note.text_placeholder") })).toHaveProperty(
    "value",
    "Newer local body",
  );
});

// spec:test note-editor#limit-title-200-characters
// spec:test note-editor#stop-accepting-text-after-20-000-characters
// spec:test notes-grid-folders#open-screen-7-4-folder-tile
test("clamps Unicode characters, creates under the chosen folder, and reloads the same ID", async () => {
  const folderContext = "?folder_id=" + ids.folder;
  setRoute(newHref + folderContext);
  let createdNote: Note | null = null;
  const requests = setup(async (request, path) => {
    if (request.method === "POST" && path === "/notes") {
      const body = (await request.json()) as Schemas["NoteCreate"];
      createdNote = note({ title: body.title, text: body.text, folder_id: body.folder_id });
      return json(createdNote, 201);
    }
    if (request.method === "GET" && path === noteApi && createdNote) return json(createdNote);
  });
  render(view(<NewNotePage />));
  await screen.findByRole("textbox", { name: t("note.title_placeholder") });
  const title = "🌿".repeat(200);
  const text = "🚲".repeat(20_000);
  edit("note.title_placeholder", title + "X");
  edit("note.text_placeholder", text + "X");
  expect(screen.getByText(t("note.too_long"))).toBeTruthy();
  expect(await screen.findByText(t("note.saved"))).toBeTruthy();
  const posts = calls(requests, "POST", "/notes");
  expect(posts).toHaveLength(1);
  expect(posts[0]?.headers.get("Idempotency-Key")).toMatch(/^[a-f\d-]{36}$/u);
  expect(await posts[0]?.json()).toEqual({ title, text, folder_id: ids.folder });

  cleanup();
  render(view(<NewNotePage />));
  await waitFor(() => expect(nav.replace).toHaveBeenCalledWith(noteHref + folderContext));
  expect(screen.queryByRole("textbox", { name: t("note.title_placeholder") })).toBeNull();
  cleanup();
  setRoute(noteHref + folderContext);
  render(view(<NotePage />));
  expect(await screen.findByRole("textbox", { name: t("note.title_placeholder") })).toHaveProperty(
    "value",
    title,
  );
  expect(calls(requests, "POST", "/notes")).toHaveLength(1);
});

test("replays the original create attempt with its key and patches later edits after a lost response", async () => {
  let createdNote: Note | null = null;
  const requests = setup(async (request, path) => {
    if (request.method === "POST" && path === "/notes") {
      if (createdNote) return json(createdNote, 201);
      const body = (await request.json()) as Schemas["NoteCreate"];
      createdNote = note({ title: body.title, text: body.text });
      throw new TypeError("The response was lost after commit.");
    }
    if (request.method === "PATCH" && path === noteApi) {
      return json(
        note({ title: "Later input", text: createdNote?.text ?? "", updated_at: modified }),
      );
    }
  });
  render(view(<NewNotePage />));
  await screen.findByRole("textbox", { name: t("note.title_placeholder") });
  edit("note.title_placeholder", "Initial input");
  expect(await screen.findByText(t("extra.auth_network_error"))).toBeTruthy();
  edit("note.title_placeholder", "Later input");
  expect(await screen.findByText(t("note.saved"))).toBeTruthy();
  const posts = calls(requests, "POST", "/notes");
  expect(posts).toHaveLength(2);
  expect(posts[0]?.headers.get("Idempotency-Key")).toBe(posts[1]?.headers.get("Idempotency-Key"));
  expect(await posts[1]?.json()).toEqual(await posts[0]?.json());
  expect(await calls(requests, "PATCH", noteApi)[0]?.json()).toEqual({ title: "Later input" });
});

// spec:test note-editor#start-note-opened-meeting-card
// spec:test meeting-card#create-new-note-write-note-first-line
// spec:test meeting-card#tag-client-note-created-meeting
// spec:test note-editor#attach-note-meeting-record-meeting
// spec:test note-sharing-tags#copy-private-client-card-fields
test.each(["meeting", "client"] as const)(
  "fetches a %s source once and creates only after a user edit",
  async (source) => {
    const fromMeeting = source === "meeting";
    const id = fromMeeting ? ids.meeting : ids.linked;
    const path = (fromMeeting ? "/meetings/" : "/clients/") + id;
    const origin = (fromMeeting ? "/app/meetings/" : "/app/people/clients/") + id;
    const target = newHref + "?" + source + "_id=" + id;
    const requests = setup(async (request, url) => {
      if (request.method === "POST" && url === "/notes") {
        const data = (await request.json()) as Schemas["NoteCreate"];
        return json(note(data), 201);
      }
    });
    setRoute(origin, id);
    render(view(fromMeeting ? <MeetingPage /> : <ClientCardPage />));
    fireEvent.click(
      await screen.findByRole("button", {
        name: t(fromMeeting ? "card.write_note" : "client.note"),
      }),
    );
    expect(nav.push).toHaveBeenCalledWith(target);
    const initialReads = calls(requests, "GET", path).length;

    cleanup();
    setRoute(target);
    render(view(<NewNotePage />));
    const line = fromMeeting
      ? t("from_meeting.first_line", {
          name: meeting().with_whom ?? "",
          date: formatDate(created, timeZone, "en"),
        })
      : card().name + ", " + formatDate(new Date().toISOString(), timeZone, "en");
    expect(await screen.findByText(line)).toBeTruthy();
    expect(screen.getByRole("textbox", { name: t("note.title_placeholder") })).toHaveProperty(
      "value",
      "",
    );
    expect(calls(requests, "GET", path)).toHaveLength(initialReads + 1);
    expect(screen.queryByText(/Never copy|Sensitive comment/u)).toBeNull();
    fireEvent.click(button("extra.close"));
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith(origin));
    expect(calls(requests, "POST", "/notes")).toHaveLength(0);

    cleanup();
    setRoute(target);
    render(view(<NewNotePage />));
    await screen.findByText(line);
    fireEvent.click(screen.getByText(line));
    await screen.findByRole("textbox", { name: t("note.text_placeholder") });
    edit("note.text_placeholder", line + "\nUser observation");
    expect(await screen.findByText(t("note.saved"))).toBeTruthy();
    const posts = calls(requests, "POST", "/notes");
    expect(posts).toHaveLength(1);
    expect(await posts[0]?.json()).toEqual({
      title: "",
      text: line + "\nUser observation",
      folder_id: null,
    });
    expect(calls(requests, "GET", path)).toHaveLength(initialReads + 2);
    expect(calls(requests, "POST", noteApi + "/tags")).toHaveLength(0);
  },
);

test("ignores raw first-line query text and denies a source the account cannot read", async () => {
  setRoute(newHref + "?first_line=" + encodeURIComponent("Untrusted source text"));
  let requests = setup();
  render(view(<NewNotePage />));
  expect(await screen.findByRole("textbox", { name: t("note.text_placeholder") })).toHaveProperty(
    "value",
    "",
  );
  expect(calls(requests, "POST", "/notes")).toHaveLength(0);

  cleanup();
  setRoute(newHref + "?meeting_id=" + ids.meeting);
  requests = setup((request, path) =>
    request.method === "GET" && path === "/meetings/" + ids.meeting
      ? json({ code: "not_found" }, 404)
      : undefined,
  );
  render(view(<NewNotePage />));
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(screen.queryByRole("textbox", { name: t("note.text_placeholder") })).toBeNull();
  expect(calls(requests, "POST", "/notes")).toHaveLength(0);
});

// spec:test note-editor#use-first-line-text-note
test("derives a tile title and recognizes the API's checklist positions across Unicode separators", () => {
  const text =
    "First line\r\n  - [ ] Alpha\u2028Beta\r\n- [X] Gamma\u2029Delta\r\n- Ordinary bullet";
  const entry = note({ title: "", text });
  expect(noteTitle(entry)).toBe("First line");
  expect(parseNoteText(text).filter(({ kind }) => kind === "checklist")).toEqual([
    { kind: "checklist", text: "Alpha\u2028Beta", position: 0, checked: false },
    { kind: "checklist", text: "Gamma\u2029Delta", position: 1, checked: true },
  ]);
  expect(toggleAuthorItem(text, 1)).toBe(text.replace("[X]", "[ ]"));
  expect(toShareText(entry)).toBe(
    "First line\n☐ Alpha\u2028Beta\n☑ Gamma\u2029Delta\n- Ordinary bullet",
  );
});

// spec:test note-editor#show-formatting-bar-above-keyboard
// spec:test note-editor#recognize-links-text-automatically-open
// spec:test note-editor#toggle-checklist-item-author-taps
// spec:test note-editor#open-system-share-sheet-send-text
test("formats text in place, toggles author checklist items, opens safe links and shares the authored checks", async () => {
  setRoute(noteHref);
  const initialText =
    "## Homework\n- [ ] Read\n- [x] Done\nRead HTTPS://example.test/manual.\n[Unsafe](javascript:alert)\n<script>plain text</script>";
  let text = initialText;
  const requests = setup(
    async (request, path) => {
      if (request.method === "PATCH" && path === noteApi) {
        const patch = (await request.json()) as Update;
        text = patch.text ?? text;
        return json(note({ text, updated_at: modified }));
      }
    },
    { note: note({ text }) },
  );
  const share = vi.fn<Navigator["share"]>().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { onLine: true, language: "en-US", share });
  const { container } = render(view(<NotePage />));
  expect(await screen.findByRole("heading", { name: "Homework" })).toBeTruthy();
  expect(
    screen.getByRole("link", { name: "HTTPS://example.test/manual" }).getAttribute("href"),
  ).toBe("https://example.test/manual");
  expect(screen.queryByRole("link", { name: "Unsafe" })).toBeNull();
  expect(container.querySelector("script")).toBeNull();
  const formatting = within(screen.getByRole("group", { name: t("extra.note_formatting") }));
  expect(formatting.getAllByRole("button")).toHaveLength(4);
  for (const key of [
    "extra.note_bulleted_list",
    "extra.note_numbered_list",
    "extra.note_checklist",
  ] as const) {
    expect(formatting.getByRole("button", { name: t(key) })).toBeTruthy();
  }

  const read = screen.getByRole("checkbox", { name: "Read" });
  fireEvent.click(read);
  expect(read).toHaveProperty("checked", true);
  expect(read.closest("li")?.dataset.checked).toBe("true");
  fireEvent.click(read);
  expect(read).toHaveProperty("checked", false);
  fireEvent.click(read);
  expect(await screen.findByText(t("note.saving"))).toBeTruthy();

  fireEvent.click(screen.getByRole("heading", { name: "Homework" }));
  const field = (await screen.findByRole("textbox", {
    name: t("note.text_placeholder"),
  })) as HTMLTextAreaElement;
  field.setSelectionRange(3, 11);
  fireEvent.click(formatting.getByRole("button", { name: t("extra.note_bold") }));
  expect(field.value).toContain("## **Homework**");
  fireEvent.blur(field);
  expect(await screen.findByText(t("note.saved"))).toBeTruthy();
  expect(await calls(requests, "PATCH", noteApi).at(-1)?.json()).toMatchObject({
    text:
      "## **Homework**" +
      initialText.slice("## Homework".length).replace("- [ ] Read", "- [x] Read"),
  });

  fireEvent.click(button("extra.note_actions"));
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", { name: t("note.send_text") }),
  );
  expect(share).toHaveBeenCalledWith({
    text: expect.stringContaining("Session record\n\n## **Homework**\n☑ Read\n☑ Done"),
  });
});

// spec:test note-editor#show-leader-note-menu-tag
// spec:test note-editor#show-non-leader-note-menu-move
// spec:test note-sharing-tags#offer-tag-screen-7-3-non-leader
test.each([true, false])(
  "shows the appropriate author menu and tag gate for leader=%s",
  async (leader) => {
    setRoute(noteHref);
    const requests = setup(undefined, { leader });
    render(view(<NotePage />));
    fireEvent.click(await screen.findByRole("button", { name: t("extra.note_actions") }));
    const menu = within(screen.getByRole("dialog"));
    for (const key of ["note.move", "note.send_text", "note.delete"] as const) {
      expect(menu.getByRole("button", { name: t(key) })).toBeTruthy();
    }
    const option = menu.queryByRole("button", { name: t("note.tag") });
    if (leader) {
      expect(option).toBeTruthy();
      fireEvent.click(option!);
      await waitFor(() => expect(nav.push).toHaveBeenCalledWith(noteHref + "/tag"));
    } else {
      expect(option).toBeNull();
      cleanup();
      setRoute(noteHref + "/tag");
      render(view(<TagNotePage />));
      expect(await screen.findByRole("alert")).toBeTruthy();
      expect(calls(requests, "GET", "/notes/taggable")).toHaveLength(0);
    }
  },
);

// spec:test notes-grid-folders#open-list-account-folders-extra
test("moves only the folder through the author's editor menu, including the No folder option", async () => {
  setRoute(noteHref + "?folder_id=" + ids.folder);
  let stored = note({ folder_id: ids.folder });
  const requests = setup(async (request, path) => {
    if (path !== noteApi) return;
    if (request.method === "GET") return json(stored);
    if (request.method === "PATCH") {
      const update = (await request.json()) as Update;
      stored = { ...stored, folder_id: update.folder_id ?? null };
      return json(stored);
    }
  });
  render(view(<NotePage />));
  fireEvent.click(await screen.findByRole("button", { name: t("extra.note_actions") }));
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: t("note.move") }));
  const target = noteHref + "/move?folder_id=" + ids.folder;
  await waitFor(() => expect(nav.push).toHaveBeenCalledWith(target));
  cleanup();
  setRoute(target);
  render(view(<MoveNotePage />));
  const folder = await screen.findByRole("button", { name: "Practice" });
  expect(folder.getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(button("notes.no_folder"));
  await waitFor(() =>
    expect(nav.replace).toHaveBeenCalledWith(noteHref + "?folder_id=" + ids.folder),
  );
  expect(await calls(requests, "PATCH", noteApi)[0]?.json()).toEqual({ folder_id: null });
});

// spec:test note-editor#ask-delete-confirm-after-delete
test("keeps the note through a cancelled delete confirmation and deletes on confirmation", async () => {
  setRoute(noteHref);
  const requests = setup((request, path) =>
    request.method === "DELETE" && path === noteApi
      ? new Response(null, { status: 204 })
      : undefined,
  );
  render(view(<NotePage />));
  fireEvent.click(await screen.findByRole("button", { name: t("note.delete") }));
  const title = t("note.delete_confirm");
  const first = within(screen.getByRole("dialog", { name: title }));
  fireEvent.click(first.getByRole("button", { name: t("share.cancel") }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(calls(requests, "DELETE", noteApi)).toHaveLength(0);
  fireEvent.click(button("note.delete"));
  fireEvent.click(
    within(screen.getByRole("dialog", { name: title })).getByRole("button", {
      name: t("note.delete"),
    }),
  );
  await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/app/notes"));
  expect(calls(requests, "DELETE", noteApi)).toHaveLength(1);
});

// spec:test note-sharing-tags#open-screen-7-3-tag-leader
// spec:test note-sharing-tags#list-screen-7-3-person-not-one
// spec:test note-sharing-tags#show-after-person-picked-leader
// spec:test note-sharing-tags#show-confirm-picked-person-name
// spec:test note-sharing-tags#show-joy-character-tag-confirmation
// spec:test note-sharing-tags#add-warning-confirmation-picked-card
// spec:test note-sharing-tags#tag-person-after-button-record
// spec:test note-sharing-tags#allow-several-people-tagged-one
// spec:test note-sharing-tags#show-first-tag-warning-person-leader
test("searches the leader's cards, confirms first and later tags, and offers standalone sharing without tagging", async () => {
  setRoute(noteHref + "/tag");
  const standalone: Person = {
    target_id: ids.standalone,
    name: "Lin",
    photo_url: null,
    linked: false,
    tagged_before: false,
  };
  const linked: Person = {
    target_id: ids.linked,
    name: "Grace",
    photo_url: null,
    linked: true,
    tagged_before: true,
  };
  let stored = note();
  const requests = setup(async (request, path) => {
    if (request.method === "GET" && path === noteApi) return json(stored);
    if (request.method === "GET" && path === "/notes/taggable")
      return json({ items: [standalone, linked] });
    if (request.method === "POST" && path === noteApi + "/tags") {
      const body = (await request.json()) as Schemas["NoteTagCreate"];
      const person = body.target_id === ids.standalone ? standalone : linked;
      stored = {
        ...stored,
        tags: [
          ...stored.tags,
          tag({
            id: person.target_id,
            target_id: person.target_id,
            name: person.name,
            linked: person.linked,
          }),
        ],
      };
      return json(stored, 201);
    }
  });
  const share = vi.fn<Navigator["share"]>().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { onLine: true, language: "en-US", share });
  render(view(<TagNotePage />));
  await screen.findByRole("button", { name: standalone.name });
  const search = screen.getByRole("searchbox", { name: t("extra.client_search") });
  fireEvent.change(search, { target: { value: "li" } });
  expect(screen.queryByRole("button", { name: linked.name })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: standalone.name }));
  let dialog = screen.getByRole("dialog", { name: t("share.button") });
  let actions = within(dialog);
  expect(actions.getByText(t("share.first_warning", { Name: standalone.name }))).toBeTruthy();
  expect(actions.queryByText(t("share.confirm", { Name: standalone.name }))).toBeNull();
  expect(actions.getByText(t("share.not_in_app", { Name: standalone.name }))).toBeTruthy();
  expect(dialog.querySelector("picture")?.querySelector("img")).toBeTruthy();
  fireEvent.click(actions.getByRole("button", { name: t("client.invite") }));
  fireEvent.click(actions.getByRole("button", { name: t("note.send_text") }));
  expect(share).toHaveBeenNthCalledWith(1, {
    text: t("extra.client_invite_text", { link: address }),
  });
  expect(share).toHaveBeenNthCalledWith(2, { text: note().title + "\n\n" + note().text });
  fireEvent.click(actions.getByRole("button", { name: t("share.cancel") }));
  expect(calls(requests, "POST", noteApi + "/tags")).toHaveLength(0);

  fireEvent.click(screen.getByRole("button", { name: standalone.name }));
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", { name: t("share.button") }),
  );
  await waitFor(() => expect(nav.replace).toHaveBeenCalledWith(noteHref));
  cleanup();
  render(view(<TagNotePage />));
  fireEvent.click(await screen.findByRole("button", { name: linked.name }));
  expect(screen.queryByRole("button", { name: standalone.name })).toBeNull();
  dialog = screen.getByRole("dialog", { name: t("share.button") });
  actions = within(dialog);
  expect(actions.getByText(t("share.confirm", { Name: linked.name }))).toBeTruthy();
  expect(actions.queryByText(t("share.first_warning", { Name: linked.name }))).toBeNull();
  expect(actions.queryByRole("button", { name: t("client.invite") })).toBeNull();
  fireEvent.click(actions.getByRole("button", { name: t("share.button") }));
  await waitFor(() => expect(nav.replace).toHaveBeenCalledTimes(2));
  const posts = calls(requests, "POST", noteApi + "/tags");
  expect(await Promise.all(posts.map((request) => request.json()))).toEqual([
    { target_id: ids.standalone },
    { target_id: ids.linked },
  ]);
  expect(
    calls(requests, "GET", "/notes/taggable").every(
      (request) => new URL(request.url).search === "",
    ),
  ).toBe(true);

  cleanup();
  setRoute(noteHref);
  render(view(<NotePage />));
  expect(await screen.findByRole("button", { name: standalone.name })).toBeTruthy();
  expect(screen.getByRole("button", { name: linked.name })).toBeTruthy();
});

// spec:test note-sharing-tags#offer-remove-access-author-taps-tagged
// spec:test client-archive-restore#keep-note-tags-archived-active
test("shows an archived tag in grey and refreshes the authorized tag set after withdrawal", async () => {
  setRoute(noteHref);
  const archived = tag({ name: "Archived tag", archived: true });
  const overlapping = tag({
    id: ids.author,
    name: "Automatic tag",
    target_id: ids.author,
    target_kind: "account",
  });
  const independent = tag({
    id: ids.standalone,
    name: "Independent tag",
    target_id: ids.standalone,
  });
  let stored = note({ tags: [archived, overlapping, independent] });
  const requests = setup((request, path) => {
    if (request.method === "GET" && path === noteApi) return json(stored);
    if (request.method === "DELETE" && path === noteApi + "/tags/" + archived.id) {
      stored = { ...stored, tags: [independent], updated_at: modified };
      return new Response(null, { status: 204 });
    }
  });
  render(view(<NotePage />));
  const avatar = await screen.findByRole("button", { name: archived.name });
  expect(avatar.closest("li")?.dataset.archived).toBe("true");
  fireEvent.click(avatar);
  fireEvent.click(
    within(screen.getByRole("dialog", { name: archived.name })).getByRole("button", {
      name: t("note.remove_access"),
    }),
  );
  await waitFor(() => expect(screen.queryByRole("button", { name: overlapping.name })).toBeNull());
  expect(screen.queryByRole("button", { name: archived.name })).toBeNull();
  expect(screen.getByRole("button", { name: independent.name })).toBeTruthy();
  expect(calls(requests, "DELETE", noteApi + "/tags/" + archived.id)).toHaveLength(1);
});

// spec:test note-editor#show-received-note-opens-read-only
// spec:test note-editor#show-delete-received-note
// spec:test note-sharing-tags#open-received-note-read-only-recipient
// spec:test note-sharing-tags#reveal-tagged-people-other-tagged
// spec:test note-sharing-tags#let-tagged-person-leader-non-leader
// spec:test note-sharing-tags#show-author-changes-tagged-person
// spec:test note-sharing-tags#close-note-recipient-side-access-removed
// spec:test note-sharing-tags#show-reply-bottom-received-note
test.each([true, false])(
  "protects received notes, refreshes a reordered checklist and drops access for leader=%s",
  async (leader) => {
    setRoute(noteHref);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    let stored = received({
      text: "- [x] Read\n- [ ] Write",
      tags: [tag({ name: "Hidden recipient" })],
      folder_id: ids.folder,
    });
    let revoked = false;
    let count = 0;
    const requests = setup(
      async (request, path) => {
        if (request.method === "GET" && path === noteApi)
          return revoked ? json({ code: "not_found" }, 404) : json(stored);
        if (request.method === "PUT" && path === noteApi + "/checklist-ticks") {
          count += 1;
          const body = (await request.json()) as Schemas["NoteChecklistTicks"];
          if (count === 2) {
            stored = {
              ...stored,
              text: "- [ ] New step\n- [x] Read\n- [ ] Write",
              updated_at: modified,
              checked_items: [1],
            };
            return json({ code: "conflict" }, 409);
          }
          stored = { ...stored, checked_items: body.checked_items };
          return json(stored);
        }
      },
      { leader },
    );
    render(view(<NotePage />));
    expect(await screen.findByRole("heading", { name: stored.title })).toBeTruthy();
    expect(screen.getByText(stored.author.name)).toBeTruthy();
    expect(screen.queryByText("Hidden recipient")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button", { name: t("note.delete") })).toBeNull();
    expect(button("note.reply").closest("footer")).toBeTruthy();
    fireEvent.click(button("extra.note_actions"));
    const menu = within(screen.getByRole("dialog"));
    expect(menu.getByRole("button", { name: t("note.reply") })).toBeTruthy();
    expect(menu.getByRole("button", { name: t("note.send_text") })).toBeTruthy();
    for (const key of ["note.tag", "note.move", "note.delete"] as const) {
      expect(menu.queryByRole("button", { name: t(key) })).toBeNull();
    }
    fireEvent.click(menu.getByRole("button", { name: t("extra.close") }));
    const checkbox = (name: string): HTMLElement => screen.getByRole("checkbox", { name });
    expect(checkbox("Read")).toHaveProperty("checked", false);
    fireEvent.click(checkbox("Read"));
    await waitFor(() => expect(checkbox("Read")).toHaveProperty("checked", true));
    fireEvent.click(checkbox("Write"));
    expect(await screen.findByText(t("extra.note_checklist_changed"))).toBeTruthy();
    await screen.findByRole("checkbox", { name: "New step" });
    expect(checkbox("Read")).toHaveProperty("checked", true);
    expect(checkbox("Write")).toHaveProperty("checked", false);
    fireEvent.click(checkbox("Read"));
    await waitFor(() => expect(checkbox("Read")).toHaveProperty("checked", false));
    const ticks = calls(requests, "PUT", noteApi + "/checklist-ticks");
    expect(await Promise.all(ticks.map((request) => request.json()))).toEqual([
      { checked_items: [0], expected_updated_at: created, expected_checked_items: [] },
      { checked_items: [0, 1], expected_updated_at: created, expected_checked_items: [0] },
      { checked_items: [], expected_updated_at: modified, expected_checked_items: [1] },
    ]);
    expect(calls(requests, "PATCH", noteApi)).toHaveLength(0);

    stored = { ...stored, title: "Author refreshed title" };
    fireEvent.focus(window);
    expect(await screen.findByRole("heading", { name: stored.title })).toBeTruthy();
    revoked = true;
    fireEvent.focus(window);
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/app/notes?access_removed=1"));
    expect(screen.queryByRole("heading", { name: stored.title })).toBeNull();
  },
);

// spec:test notes-grid-folders#move-received-note-account-folders
test("blocks a received note opened directly at its move route", async () => {
  setRoute(noteHref + "/move");
  const requests = setup(undefined, { note: received() });
  render(view(<MoveNotePage />));
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(calls(requests, "GET", "/folders")).toHaveLength(0);
  expect(calls(requests, "PATCH", noteApi)).toHaveLength(0);
});

// spec:test note-sharing-tags#create-reply-new-note-owned
test("replies immediately to a received note with a bounded first line and a stable retry key", async () => {
  setRoute(noteHref);
  const longLine = "📝".repeat(10_000);
  const expected = t("note.reply_first_line", { title: "📝".repeat(200) });
  let reply: Note | null = null;
  const requests = setup(
    async (request, path) => {
      if (request.method === "POST" && path === noteApi + "/replies") {
        if (reply) return json(reply, 201);
        const body = (await request.json()) as Schemas["NoteReplyCreate"];
        reply = note({
          id: ids.reply,
          title: "",
          text: body.text,
          tags: [tag({ target_kind: "account", target_id: ids.author, name: "Grace Hopper" })],
        });
        throw new TypeError("Lost confirmation");
      }
    },
    { leader: false, note: received({ title: "", text: longLine }) },
  );
  render(view(<NotePage />));
  fireEvent.click(await screen.findByRole("button", { name: t("note.reply") }));
  expect(await screen.findByText(t("extra.auth_network_error"))).toBeTruthy();
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(button("note.reply"));
  await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/app/notes/" + ids.reply));
  const posts = calls(requests, "POST", noteApi + "/replies");
  expect(posts).toHaveLength(2);
  expect(posts[0]?.headers.get("Idempotency-Key")).toBe(posts[1]?.headers.get("Idempotency-Key"));
  expect(await Promise.all(posts.map((request) => request.json()))).toEqual([
    { text: expected },
    { text: expected },
  ]);
});
