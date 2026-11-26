import type { Schemas } from "./api/client";
import { currentContour, type Contour } from "./contour";
import { zonedDay } from "./zoned-date";

type Note = Schemas["Note"];
type MeetingList = Schemas["MeetingList"];
type Account = Schemas["Account"];
type FolderList = Schemas["FolderList"];
type NoteList = Schemas["NoteList"];

export interface OfflineMeetingRange {
  from: string;
  to: string;
}

interface SavedMeetingWindow extends OfflineMeetingRange {
  timeZone: string;
  list: MeetingList;
}

interface SavedNoteList {
  key: string;
  ids: string[];
  total: number;
}

interface OfflineSnapshot {
  account?: Account;
  meetings: SavedMeetingWindow[];
  notes: Note[];
  noteLists: SavedNoteList[];
  folders?: FolderList;
}

const cachePrefix = "celmento-offline-v1:";
const maxMeetingWindows = 8;
const maxNotes = 48;
const maxNotesPerList = 24;
const maxNoteLists = 5;
const maxSnapshotLength = 1_500_000;
let lastKey: {
  token: string;
  contour: Contour;
  value: Promise<string | null>;
} | null = null;

function cacheKey(token: string): Promise<string | null> {
  const contour = currentContour();
  if (lastKey?.token === token && lastKey.contour === contour) return lastKey.value;
  const subtle = globalThis.crypto?.subtle;
  if (!subtle || typeof window === "undefined") return Promise.resolve(null);

  const value = subtle
    .digest("SHA-256", new TextEncoder().encode(contour + "\n" + token))
    .then(
      (result) =>
        cachePrefix +
        Array.from(new Uint8Array(result), (byte) => byte.toString(16).padStart(2, "0")).join(""),
    )
    .catch(() => null);
  lastKey = { token, contour, value };
  return value;
}

export async function offlineCache(
  currentSessionToken: () => string | null,
): Promise<OfflineCache | null> {
  const token = currentSessionToken();
  if (!token) return null;
  const key = await cacheKey(token);
  return key && currentSessionToken() === token
    ? new OfflineCache(key, () => currentSessionToken() === token)
    : null;
}

export async function retireOfflineSession(token: string): Promise<void> {
  const key = await cacheKey(token);
  if (!key) return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Private browsing or a device policy can disable storage.
  }
}

function emptySnapshot(): OfflineSnapshot {
  return { meetings: [], notes: [], noteLists: [] };
}

function overlaps(left: OfflineMeetingRange, right: OfflineMeetingRange): boolean {
  return left.from <= right.to && right.from <= left.to;
}

function includesDay(range: OfflineMeetingRange, day: string): boolean {
  return range.from <= day && day <= range.to;
}

function updateMeetingRows<Row extends { id: string; starts_at: string }>(
  rows: Map<string, Row>,
  fresh: Row[],
  window: SavedMeetingWindow,
  requested: OfflineMeetingRange,
): void {
  for (const [id, row] of rows) {
    if (includesDay(window, zonedDay(row.starts_at, window.timeZone))) rows.delete(id);
  }
  for (const row of fresh) {
    rows.delete(row.id);
    if (includesDay(requested, zonedDay(row.starts_at, window.timeZone))) {
      rows.set(row.id, row);
    }
  }
}

export class OfflineCache {
  constructor(
    private readonly key: string,
    private readonly isCurrent: () => boolean,
  ) {}

  private read(): OfflineSnapshot {
    if (this.isCurrent()) {
      try {
        const value = window.localStorage.getItem(this.key);
        const saved: unknown = value && JSON.parse(value);
        if (
          saved &&
          typeof saved === "object" &&
          "meetings" in saved &&
          Array.isArray(saved.meetings) &&
          "notes" in saved &&
          Array.isArray(saved.notes) &&
          "noteLists" in saved &&
          Array.isArray(saved.noteLists)
        ) {
          return saved as OfflineSnapshot;
        }
      } catch {
        // Storage may be disabled or contain an invalid snapshot.
      }
    }
    return emptySnapshot();
  }

  private write(snapshot: OfflineSnapshot): void {
    if (!this.isCurrent()) return;
    try {
      const encoded = JSON.stringify(snapshot);
      if (encoded.length <= maxSnapshotLength) window.localStorage.setItem(this.key, encoded);
    } catch {
      // Live application data is independent of the offline cache.
    }
  }

  account(): Account | null {
    return this.read().account ?? null;
  }

  saveAccount(account: Account): void {
    this.write({ ...this.read(), account });
  }

  clear(): void {
    if (!this.isCurrent()) return;
    try {
      window.localStorage.removeItem(this.key);
    } catch {
      // A disabled store has no accessible cached data.
    }
  }

  meetings(range: OfflineMeetingRange, timeZone: string): MeetingList | null {
    const windows = this.read().meetings.filter((window) => window.timeZone === timeZone);
    const latest = windows.find((window) => overlaps(window, range));
    if (!latest) return null;
    const own = new Map<string, Schemas["Meeting"]>();
    const attended = new Map<string, Schemas["AttendedMeeting"]>();
    for (const window of windows.toReversed()) {
      updateMeetingRows(own, window.list.items, window, range);
      updateMeetingRows(attended, window.list.attended, window, range);
    }
    return {
      ...latest.list,
      items: [...own.values()],
      attended: [...attended.values()],
      next_outcome_in_seconds: null,
    };
  }

  saveMeetings(range: OfflineMeetingRange, timeZone: string, list: MeetingList): void {
    const snapshot = this.read();
    const previous = snapshot.meetings.filter(
      (window) =>
        window.timeZone === timeZone && !(range.from <= window.from && window.to <= range.to),
    );
    const meetings = [{ ...range, timeZone, list }, ...previous].slice(0, maxMeetingWindows);
    this.write({ ...snapshot, meetings });
  }

  removeMeetings(): void {
    this.write({ ...this.read(), meetings: [] });
  }

  note(id: string): Note | null {
    return this.read().notes.find((note) => note.id === id) ?? null;
  }

  saveNote(note: Note): void {
    const snapshot = this.read();
    const notes = [note, ...snapshot.notes.filter((entry) => entry.id !== note.id)];
    this.write({ ...snapshot, notes: notes.slice(0, maxNotes) });
  }

  removeNote(id: string): void {
    const snapshot = this.read();
    this.write({
      ...snapshot,
      notes: snapshot.notes.filter((note) => note.id !== id),
      noteLists: snapshot.noteLists.map((list) => ({
        ...list,
        ids: list.ids.filter((entry) => entry !== id),
      })),
    });
  }

  noteList(key: string): NoteList | null {
    const snapshot = this.read();
    const list = snapshot.noteLists.find((entry) => entry.key === key);
    if (!list) return null;
    const notes = new Map(snapshot.notes.map((note) => [note.id, note]));
    const items = list.ids.flatMap((id) => {
      const note = notes.get(id);
      return note ? [note] : [];
    });
    return { items, total: list.total };
  }

  saveNoteList(key: string, list: NoteList): void {
    const snapshot = this.read();
    const items = list.items.slice(0, maxNotesPerList);
    const ids = items.map((note) => note.id);
    const refreshed = new Set(ids);
    const notes = [...items, ...snapshot.notes.filter((note) => !refreshed.has(note.id))].slice(
      0,
      maxNotes,
    );
    const noteLists = [
      { key, ids, total: list.total },
      ...snapshot.noteLists.filter((entry) => entry.key !== key),
    ].slice(0, maxNoteLists);
    this.write({ ...snapshot, notes, noteLists });
  }

  removeNoteList(key: string): void {
    const snapshot = this.read();
    this.write({
      ...snapshot,
      noteLists: snapshot.noteLists.filter((list) => list.key !== key),
    });
  }

  folders(): FolderList | null {
    return this.read().folders ?? null;
  }

  saveFolders(folders: FolderList): void {
    this.write({ ...this.read(), folders });
  }

  removeFolders(): void {
    const snapshot = this.read();
    delete snapshot.folders;
    this.write(snapshot);
  }
}
