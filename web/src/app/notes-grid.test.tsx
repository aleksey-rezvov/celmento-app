import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import type { Schemas } from "@/lib/api/client";
import { t } from "@/lib/i18n";
import { setSessionToken } from "@/lib/session";
import AppLayout from "./(app)/app/layout";
import EditFolderPage from "./(app)/app/notes/folders/[id]/edit/page";
import FolderPage from "./(app)/app/notes/folders/[id]/page";
import NewFolderPage from "./(app)/app/notes/folders/new/page";
import Notes from "./(app)/app/notes/page";

const navigation = vi.hoisted(() => ({
  router: { push: vi.fn(), replace: vi.fn() },
  pathname: "/app/notes",
  folderId: "",
}));

vi.mock("next/navigation", () => ({
  useRouter: () => navigation.router,
  useParams: () => ({ id: navigation.folderId }),
  usePathname: () => navigation.pathname,
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

type Account = Schemas["Account"];
type Note = Schemas["Note"];
type Tag = Schemas["NoteTag"];
type Folder = Schemas["Folder"];
const origin = "https://world-api.example.test";
const session = "notes-grid-session";
const notesPath = "/app/notes";
const accountId = "019ac7a0-0000-7ab1-b031-100000000001";
const firstFolderId = "019ac7a0-0000-7ab1-b031-200000000001";
const secondFolderId = "019ac7a0-0000-7ab1-b031-200000000002";
const missingFolderId = "019ac7a0-0000-7ab1-b031-200000000003";
const older = "2026-11-11T21:00:00Z";
const newer = "2026-11-15T23:15:00Z";

function accountFor(activated: boolean): Account {
  return {
    id: accountId,
    contour: "world",
    email: "owner@example.test",
    first_name: "Ada",
    last_name: "Lovelace",
    login: "adalovelace",
    address_url: "https://celmento.com/adalovelace",
    photo_url: null,
    phone: null,
    telegram: null,
    whatsapp: null,
    language: "en",
    time_zone: "Europe/Belgrade",
    activated,
    activated_at: activated ? older : null,
    leader: activated
      ? {
          specializations: [],
          specialization_other: null,
          about: "",
          contact_email: null,
          links: [],
          main_channel: null,
          booking_url: "https://celmento.com/adalovelace",
          working_hours: [],
          session_duration_minutes: 60,
          session_format: "online",
          default_meeting_link: null,
          default_rate: null,
          default_currency: "EUR",
          plan: { kind: "free", active_clients: 0, client_limit: 3, subscription_until: null },
        }
      : null,
    acceptances: [],
    created_at: older,
  };
}

function note(id: string, values: Partial<Note> = {}): Note {
  return {
    id,
    author: { id: accountId, name: "Ada Lovelace", photo_url: null },
    title: "",
    text: "",
    shared_with_me: false,
    can_edit: true,
    folder_id: null,
    tags: [],
    checked_items: [],
    created_at: older,
    updated_at: older,
    ...values,
  };
}

function tag(name: string): Tag {
  return {
    id: "019ac7a0-0000-7ab1-b031-300000000001",
    target_kind: "client_card",
    target_id: "019ac7a0-0000-7ab1-b031-400000000001",
    name,
    photo_url: null,
    archived: false,
    linked: true,
    created_at: older,
  };
}

function folder(id: string, name: string, color: Folder["color"], createdAt = older): Folder {
  return { id, name, color, created_at: createdAt };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function notes(items: Note[], total = items.length): Response {
  return json({ items, total } satisfies Schemas["NoteList"]);
}

function setup(
  account: Account,
  handle: (request: Request, url: URL) => Response | Promise<Response>,
): Request[] {
  const requests: Request[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (request: Request) => {
      const url = new URL(request.url);
      if (url.origin !== origin) throw new Error("Unexpected API origin.");
      requests.push(request.clone());
      if (url.pathname === "/api/v1/account") return json(account);
      return handle(request, url);
    }),
  );
  return requests;
}

function atPath(path: string, page: ReactElement): ReactElement {
  window.history.replaceState(null, "", path);
  navigation.pathname = window.location.pathname;
  return <AppLayout>{page}</AppLayout>;
}

function button(key: Parameters<typeof t>[0]): HTMLElement {
  return screen.getByRole("button", { name: t(key) });
}

function requestsTo(requests: Request[], endpoint: string, method = "GET"): Request[] {
  return requests.filter(
    (request) =>
      request.method === method && new URL(request.url).pathname === "/api/v1" + endpoint,
  );
}

function delayedResponse(): { promise: Promise<Response>; release: (response: Response) => void } {
  let release: (response: Response) => void = () => {
    throw new Error("Expected an initialized response.");
  };
  const promise = new Promise<Response>((resolve) => {
    release = resolve;
  });
  return { promise, release };
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
  vi.stubEnv("NEXT_PUBLIC_CLM_APP_CONTOUR", "world");
  vi.stubEnv("NEXT_PUBLIC_CLM_APP_API_URL", origin);
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  navigation.folderId = firstFolderId;
  setSessionToken(session);
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

// spec:test notes-grid-folders#open-notes-tab-screen-7-1
// spec:test notes-grid-folders#show-note-tile-title-beginning
// spec:test notes-grid-folders#offer-filter-all-mine-shared-with-me
// spec:test notes-grid-folders#sort-grid-modified-date-newest
// spec:test notes-grid-folders#show-root-grid-account-notes
// spec:test notes-grid-folders#order-folder-tiles-creation-date
// spec:test notes-grid-folders#open-search-field-magnifier-notes
// spec:test notes-grid-folders#open-note-screen-7-2-tile
// spec:test notes-grid-folders#split-notes-role-show-separate
// spec:test note-sharing-tags#show-shared-note-tagged-person
// spec:test note-editor#use-first-line-text-note
test.each([false, true])(
  "browses one account's notes, folders and global search (activated: %s)",
  async (activated) => {
    const oldest = folder(firstFolderId, "Practice", "blue");
    const newest = folder(secondFolderId, "Resource", "green", newer);
    const own = note("own", {
      text: "First line becomes the title\nSecond\nThird\nFourth\nFifth\nSixth\nSeventh\nEighth\nNinth is hidden",
      tags: [tag("Private client")],
    });
    const authorPhoto = origin + "/api/v1/media/author.png";
    const shared = note("shared", {
      title: "Shared target",
      text: "A note shared with this account",
      author: { id: "other", name: "Grace Hopper", photo_url: authorPhoto },
      shared_with_me: true,
      can_edit: false,
      tags: [tag("Unexpected recipient")],
      updated_at: newer,
    });
    const tucked = note("in-folder", {
      title: "In a folder",
      text: "Target text",
      folder_id: oldest.id,
    });
    const requests = setup(accountFor(activated), (request, url) => {
      if (url.pathname === "/api/v1/folders") return json({ items: [oldest, newest] });
      if (url.pathname === "/api/v1/notes" && request.method === "GET") {
        if (url.searchParams.has("q")) return notes([shared, tucked], 3);
        switch (url.searchParams.get("filter")) {
          case "mine":
            return notes([own], 3);
          case "shared":
            return notes([shared], 3);
          default:
            return notes([shared, own], 3);
        }
      }
      throw new Error("Unexpected request to " + url.pathname);
    });
    render(atPath(notesPath, <Notes />));
    expect(await screen.findByRole("heading", { name: t("notes.title") })).toBeTruthy();
    await screen.findByRole("button", { name: own.text.split("\n")[0]! });
    const grid = within(screen.getByRole("main")).getAllByRole("list");
    expect(
      grid.map((list) =>
        within(list)
          .getAllByRole("listitem")
          .map((item) =>
            item.querySelector("button")?.getAttribute("aria-labelledby")
              ? item.querySelector(".notes-tile-title")?.textContent
              : item.textContent,
          ),
      ),
    ).toEqual([
      ["Practice", "Resource"],
      [shared.title, "First line becomes the title"],
    ]);
    const ownTile = screen.getByRole("button", { name: "First line becomes the title" });
    expect(ownTile.textContent).toContain("Eighth");
    expect(ownTile.textContent).not.toContain("Ninth is hidden");
    expect(within(ownTile).getByTitle("Private client")).toBeTruthy();
    const sharedTile = screen.getByRole("button", { name: shared.title });
    expect(within(sharedTile).getByText(t("notes.shared_badge"))).toBeTruthy();
    expect(within(sharedTile).getByText("16 November 2026").getAttribute("datetime")).toBe(newer);
    expect(sharedTile.querySelector("img")?.getAttribute("src")).toBe(authorPhoto);
    expect(within(sharedTile).queryByTitle("Unexpected recipient")).toBeNull();
    expect(screen.queryByText("In a folder")).toBeNull();
    expect(requestsTo(requests, "/folders")[0]?.headers.get("Authorization")).toBe(
      "Bearer " + session,
    );

    fireEvent.click(button("notes.mine"));
    await screen.findByRole("button", { name: "First line becomes the title" });
    expect(screen.queryByRole("button", { name: shared.title })).toBeNull();
    expect(screen.getByRole("button", { name: oldest.name })).toBeTruthy();
    fireEvent.click(button("notes.shared_with_me"));
    await screen.findByRole("button", { name: shared.title });
    expect(screen.queryByRole("button", { name: oldest.name })).toBeNull();
    expect(screen.queryByRole("button", { name: "First line becomes the title" })).toBeNull();

    fireEvent.click(button("extra.notes_search"));
    const search = screen.getByRole("searchbox", { name: t("extra.notes_search") });
    expect(document.activeElement).toBe(search);
    fireEvent.change(search, { target: { value: " Target " } });
    const inFolder = await screen.findByRole("button", { name: tucked.title });
    expect(screen.getByRole("button", { name: shared.title })).toBeTruthy();
    expect(screen.queryByRole("button", { name: oldest.name })).toBeNull();
    const query = requestsTo(requests, "/notes")
      .map((request) => new URL(request.url).searchParams)
      .find((params) => params.has("q"));
    expect([...(query ?? [])]).toEqual([["q", "Target"]]);
    fireEvent.click(inFolder);
    expect(navigation.router.push).toHaveBeenLastCalledWith(notesPath + "/" + tucked.id);
  },
);

// spec:test notes-grid-folders#show-empty-calmness-character-one
// spec:test notes-grid-folders#show-empty-shared-calmness-character
// spec:test notes-grid-folders#show-folder-empty-calmness-character
test("shows the scoped calm empty states and shows the access-revocation message once", async () => {
  const mine = folder(firstFolderId, "Practice", "blue");
  setup(accountFor(false), (_request, url) => {
    if (url.pathname === "/api/v1/folders") return json({ items: [mine] });
    if (url.pathname === "/api/v1/notes") return notes([]);
    throw new Error("Unexpected request to " + url.pathname);
  });
  const view = render(atPath(notesPath + "?access_removed=1", <Notes />));
  expect(await screen.findByRole("status")).toHaveProperty("textContent", t("note.access_removed"));
  await waitFor(() => expect(window.location.search).toBe(""));
  fireEvent.click(button("extra.notice_dismiss"));
  expect(screen.queryByRole("status")).toBeNull();
  const main = within(screen.getByRole("main"));
  expect(await main.findByText(t("notes.empty"))).toBeTruthy();
  expect(
    main
      .getAllByRole("link", { name: t("extra.note_create") })
      .map((link) => link.getAttribute("href")),
  ).toEqual([notesPath + "/new"]);
  expect(main.getByText(t("notes.empty")).parentElement?.querySelector("picture img")).toBeTruthy();

  fireEvent.click(button("notes.shared_with_me"));
  expect(await main.findByText(t("notes.empty_shared"))).toBeTruthy();
  expect(
    main.getByText(t("notes.empty_shared")).parentElement?.querySelector("picture img"),
  ).toBeTruthy();
  expect(main.queryByRole("link", { name: t("extra.note_create") })).toBeNull();
  view.rerender(atPath(notesPath + "/folders/" + mine.id, <FolderPage />));
  const empty = await screen.findByText(t("notes.folder_empty"));
  expect(empty.parentElement?.querySelector("picture img")).toBeTruthy();
});

// spec:test notes-grid-folders#open-screen-7-5-new-folder-menu
// spec:test notes-grid-folders#open-screen-7-4-folder-tile
// spec:test notes-grid-folders#open-screen-7-5-folder-name
// spec:test notes-grid-folders#ask-folder-delete-folder-name-user
test("creates, edits and deletes an owned folder while keeping its notes", async () => {
  let folders = [folder(firstFolderId, "Practice", "blue")];
  let entries = [
    note("newer-folder-note", {
      title: "Most recent folder note",
      folder_id: firstFolderId,
      updated_at: newer,
    }),
    note("older-folder-note", { title: "Earlier folder note", folder_id: firstFolderId }),
  ];
  const editablePath = notesPath + "/folders/" + firstFolderId;
  const requests = setup(accountFor(false), async (request, url) => {
    if (url.pathname === "/api/v1/notes") {
      const selected = url.searchParams.get("folder_id");
      return notes(
        entries.filter(({ folder_id }) => folder_id === selected),
        entries.length,
      );
    }
    if (url.pathname === "/api/v1/folders" && request.method === "GET")
      return json({ items: folders });
    if (url.pathname === "/api/v1/folders" && request.method === "POST") {
      const body: Schemas["FolderCreate"] = await request.json();
      const created = folder(secondFolderId, body.name, body.color, newer);
      folders = [...folders, created];
      return json(created, 201);
    }
    if (url.pathname === "/api/v1/folders/" + firstFolderId && request.method === "PATCH") {
      const body: Schemas["FolderUpdate"] = await request.json();
      folders = folders.map((old) => (old.id === firstFolderId ? { ...old, ...body } : old));
      return json(folders.find(({ id }) => id === firstFolderId));
    }
    if (url.pathname === "/api/v1/folders/" + firstFolderId && request.method === "DELETE") {
      folders = folders.filter(({ id }) => id !== firstFolderId);
      entries = entries.map((entry) =>
        entry.folder_id === firstFolderId ? { ...entry, folder_id: null } : entry,
      );
      return new Response(null, { status: 204 });
    }
    throw new Error("Unexpected request to " + url.pathname);
  });

  const view = render(atPath(notesPath, <Notes />));
  await screen.findByRole("button", { name: "Practice" });
  fireEvent.click(button("extra.notes_actions"));
  const notesActions = within(screen.getByRole("dialog", { name: t("extra.notes_actions") }));
  fireEvent.click(notesActions.getByRole("button", { name: t("notes.new_folder") }));
  expect(navigation.router.push).toHaveBeenLastCalledWith(notesPath + "/folders/new");
  view.rerender(atPath(notesPath + "/folders/new", <NewFolderPage />));
  const input = screen.getByRole("textbox", { name: t("notes.folder_name") });
  expect(input).toHaveProperty("required", true);
  expect(input).toHaveProperty("maxLength", 50);
  expect(button("extra.client_save")).toHaveProperty("disabled", true);
  const palette = within(screen.getByRole("group", { name: t("extra.folder_color") }));
  expect(
    palette.getAllByRole("button").map((swatch) => swatch.getAttribute("data-folder-color")),
  ).toEqual(["blue", "green", "peach", "pink", "lilac", "yellow"]);
  expect(
    palette
      .getByRole("button", { name: t("extra.folder_color_blue") })
      .getAttribute("aria-pressed"),
  ).toBe("true");
  fireEvent.change(input, { target: { value: "x".repeat(51) } });
  expect(button("extra.client_save")).toHaveProperty("disabled", true);
  fireEvent.change(input, { target: { value: " Work " } });
  fireEvent.click(button("extra.folder_color_peach"));
  fireEvent.click(button("extra.client_save"));
  await waitFor(() => expect(navigation.router.replace).toHaveBeenLastCalledWith(notesPath));
  expect(await requestsTo(requests, "/folders", "POST")[0]?.json()).toEqual({
    name: "Work",
    color: "peach",
  });

  view.rerender(atPath(notesPath, <Notes />));
  expect(
    (await screen.findByRole("button", { name: "Work" })).getAttribute("data-folder-color"),
  ).toBe("peach");
  fireEvent.click(screen.getByRole("button", { name: "Practice" }));
  expect(navigation.router.push).toHaveBeenLastCalledWith(editablePath);
  view.rerender(atPath(editablePath, <FolderPage />));
  await screen.findByRole("button", { name: "Most recent folder note" });
  const folderList = within(screen.getByRole("main")).getByRole("list");
  expect(
    within(folderList)
      .getAllByRole("button")
      .map((tile) => tile.querySelector(".notes-tile-title")?.textContent),
  ).toEqual(["Most recent folder note", "Earlier folder note"]);
  expect(
    within(screen.getByRole("navigation"))
      .getByRole("link", { name: t("extra.note_create") })
      .getAttribute("href"),
  ).toBe(notesPath + "/new?folder_id=" + firstFolderId);
  fireEvent.click(screen.getByRole("button", { name: "Most recent folder note" }));
  expect(navigation.router.push).toHaveBeenLastCalledWith(
    notesPath + "/newer-folder-note?folder_id=" + firstFolderId,
  );

  fireEvent.click(button("extra.folder_actions"));
  fireEvent.click(
    within(screen.getByRole("dialog", { name: t("extra.folder_actions") })).getByRole("button", {
      name: t("card.edit"),
    }),
  );
  expect(navigation.router.push).toHaveBeenLastCalledWith(editablePath + "/edit");
  view.rerender(atPath(editablePath + "/edit", <EditFolderPage />));
  const editing = await screen.findByRole("textbox", { name: t("notes.folder_name") });
  expect(editing).toHaveProperty("value", "Practice");
  fireEvent.change(editing, { target: { value: "Updated practice" } });
  fireEvent.click(button("extra.folder_color_green"));
  fireEvent.click(button("extra.client_save"));
  await waitFor(() => expect(navigation.router.replace).toHaveBeenLastCalledWith(editablePath));
  expect(await requestsTo(requests, "/folders/" + firstFolderId, "PATCH")[0]?.json()).toEqual({
    name: "Updated practice",
    color: "green",
  });

  view.rerender(atPath(notesPath, <Notes />));
  const updated = await screen.findByRole("button", { name: "Updated practice" });
  expect(updated.getAttribute("data-folder-color")).toBe("green");
  view.rerender(atPath(editablePath, <FolderPage />));
  await screen.findByRole("heading", { name: "Updated practice" });
  fireEvent.click(button("extra.folder_actions"));
  fireEvent.click(
    within(screen.getByRole("dialog", { name: t("extra.folder_actions") })).getByRole("button", {
      name: t("card.delete"),
    }),
  );
  const confirmation = within(screen.getByRole("dialog", { name: t("card.delete") }));
  expect(
    confirmation.getByText(t("notes.folder_delete", { name: "Updated practice" })),
  ).toBeTruthy();
  expect(requestsTo(requests, "/folders/" + firstFolderId, "DELETE")).toHaveLength(0);
  fireEvent.click(confirmation.getByRole("button", { name: t("card.delete") }));
  await waitFor(() =>
    expect(requestsTo(requests, "/folders/" + firstFolderId, "DELETE")).toHaveLength(1),
  );
  await waitFor(() => expect(navigation.router.replace).toHaveBeenLastCalledWith(notesPath));
  view.rerender(atPath(notesPath, <Notes />));
  expect(await screen.findByRole("button", { name: "Most recent folder note" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Earlier folder note" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Updated practice" })).toBeNull();
});

// spec:test notes-grid-folders#keep-folders-personal-account-created
test("does not load note contents or show edit controls for a folder outside the account", async () => {
  navigation.folderId = missingFolderId;
  const requests = setup(accountFor(true), (_request, url) => {
    if (url.pathname === "/api/v1/folders")
      return json({ items: [folder(firstFolderId, "Practice", "blue")] });
    throw new Error("Unexpected request to " + url.pathname);
  });
  const missing = notesPath + "/folders/" + missingFolderId;
  const view = render(atPath(missing, <FolderPage />));
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    t("extra.notes_no_results"),
  );
  expect(screen.queryByText("Practice")).toBeNull();
  expect(screen.queryByRole("button", { name: t("extra.folder_actions") })).toBeNull();
  view.rerender(atPath(missing + "/edit", <EditFolderPage />));
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    t("extra.notes_no_results"),
  );
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(requestsTo(requests, "/notes")).toHaveLength(0);
});

test("revalidates visible notes, keeps the current tiles during a refresh, and cancels on unmount", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  const visible = vi.spyOn(document, "visibilityState", "get");
  const changed = delayedResponse();
  const pending = delayedResponse();
  const shared = note("shared-one", {
    title: "Original shared note",
    shared_with_me: true,
    can_edit: false,
  });
  const own = note("own-one", { title: "Owned note" });
  let reads = 0;
  let pendingRequest: Request | undefined;
  setup(accountFor(true), (request, url) => {
    if (url.pathname === "/api/v1/folders") return json({ items: [] });
    if (url.pathname === "/api/v1/notes") {
      reads += 1;
      if (reads === 1) return notes([shared, own]);
      if (reads === 2) return changed.promise;
      if (reads === 3) return notes([own]);
      pendingRequest = request;
      return pending.promise;
    }
    throw new Error("Unexpected request to " + url.pathname);
  });
  const view = render(atPath(notesPath, <Notes />));
  await screen.findByRole("button", { name: shared.title });
  await act(async () => vi.advanceTimersByTimeAsync(5000));
  expect(reads).toBe(2);
  expect(screen.getByRole("button", { name: shared.title })).toBeTruthy();
  expect(view.container.querySelector('[aria-busy="true"]')).toBeNull();
  await act(async () => {
    window.dispatchEvent(new Event("focus"));
    changed.release(notes([{ ...shared, title: "Edited by the author" }, own]));
  });
  expect(reads).toBe(2);
  expect(await screen.findByRole("button", { name: "Edited by the author" })).toBeTruthy();

  visible.mockReturnValue("hidden");
  await act(async () => vi.advanceTimersByTimeAsync(5000));
  expect(reads).toBe(2);
  visible.mockReturnValue("visible");
  await act(async () => document.dispatchEvent(new Event("visibilitychange")));
  expect(reads).toBe(3);
  expect(screen.queryByRole("button", { name: "Edited by the author" })).toBeNull();
  expect(screen.getByRole("button", { name: own.title })).toBeTruthy();

  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(reads).toBe(4);
  expect(pendingRequest?.signal.aborted).toBe(false);
  view.unmount();
  expect(pendingRequest?.signal.aborted).toBe(true);
  await act(async () => {
    pending.release(notes([shared, own]));
    window.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(5000);
  });
  expect(reads).toBe(4);
});
