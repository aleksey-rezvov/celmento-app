"use client";

import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
} from "react";
import { OfflineHint } from "@/components/OfflineHint";
import { useAppNavigation } from "@/components/shell/navigation";
import { useAccount } from "@/lib/account";
import { apiClient, errorCode, type Schemas } from "@/lib/api/client";
import { useLanguage, useTranslation, type MessageKey } from "@/lib/i18n";
import { noteHref, notesPath } from "@/lib/notes-navigation";
import { limitNoteText, noteTitle, singleNoteLine } from "@/lib/note-text";
import { offlineCache } from "@/lib/offline-cache";
import { useOnline } from "@/lib/online";
import { ChecklistText } from "./ChecklistText";
import { NoteAccountAvatar, NoteMenu, shareNoteText } from "./NoteActions";
import { NoteFrame } from "./NoteFrame";
import { compareNoteVersions } from "./useNoteAutosave";

type Note = Schemas["Note"];

interface ReceivedNoteProps {
  initial: Note;
  back: string;
  readOnly?: boolean;
}

interface ReceivedSnapshot {
  source: Note;
  note: Note | null;
  keepTicksOnReauthorization: boolean;
}

export function ReceivedNote({ initial, back, readOnly }: ReceivedNoteProps): ReactElement {
  const t = useTranslation();
  const language = useLanguage();
  const navigate = useAppNavigation();
  const router = useRouter();
  const { currentSessionToken } = useAccount();
  const online = useOnline() && !readOnly;
  const [snapshot, setSnapshot] = useState<ReceivedSnapshot>({
    source: initial,
    note: initial,
    keepTicksOnReauthorization: false,
  });
  const [menu, setMenu] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  const changing = useRef(false);
  const writingAllowed = useRef(false);
  const pendingRead = useRef<AbortController | null>(null);
  const replyAttempt = useRef<{ text: string; key: string } | null>(null);
  const id = initial.id;
  const note = snapshot.note;

  if (snapshot.source !== initial) {
    let next = note === null ? null : initial;
    if (note) {
      const order = compareNoteVersions(initial, note);
      if (order < 0) next = note;
      else if (order === 0 && snapshot.keepTicksOnReauthorization) {
        // Checklist receipts can advance without a change to the author's version.
        next = { ...initial, checked_items: note.checked_items };
      }
    }
    setSnapshot({ source: initial, note: next, keepTicksOnReauthorization: false });
  }

  useLayoutEffect(() => {
    writingAllowed.current = online;
  }, [online]);

  const publish = useCallback((next: Note, keepTicksOnReauthorization = false): void => {
    setSnapshot((previous) =>
      previous.note && compareNoteVersions(next, previous.note) >= 0
        ? { ...previous, note: next, keepTicksOnReauthorization }
        : previous,
    );
  }, []);

  useEffect(() => {
    if (!note) return;
    let active = true;
    void offlineCache(currentSessionToken).then((cache) => {
      if (active) cache?.saveNote(note);
    });
    return () => {
      active = false;
    };
  }, [currentSessionToken, note, snapshot.source]);

  const revoke = useCallback((): void => {
    // spec:impl note-sharing-tags#close-note-recipient-side-access-removed
    setSnapshot((previous) => ({ ...previous, note: null }));
    void offlineCache(currentSessionToken).then((cache) => cache?.removeNote(id));
    router.replace(notesPath + "?access_removed=1");
  }, [currentSessionToken, id, router]);

  const refresh = useCallback(async (): Promise<void> => {
    const token = currentSessionToken();
    if (!token || !online || navigator.onLine === false || pendingRead.current) return;
    const controller = new AbortController();
    pendingRead.current = controller;
    try {
      // spec:impl note-sharing-tags#show-author-changes-tagged-person
      const { data, response } = await apiClient(token).GET("/notes/{note_id}", {
        params: { path: { note_id: id } },
        signal: controller.signal,
        cache: "no-store",
      });
      if (controller.signal.aborted || currentSessionToken() !== token) return;
      if ([401, 403, 404].includes(response.status)) revoke();
      else if (data) publish(data);
    } catch {
      // Keep the visible note while the connection recovers.
    } finally {
      if (pendingRead.current === controller) pendingRead.current = null;
    }
  }, [currentSessionToken, id, online, publish, revoke]);

  useEffect(() => {
    if (!note) return;
    function updateVisible(): void {
      if (!changing.current && document.visibilityState !== "hidden") void refresh();
    }
    const timer = window.setInterval(updateVisible, 5000);
    window.addEventListener("focus", updateVisible);
    window.addEventListener("online", updateVisible);
    document.addEventListener("visibilitychange", updateVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", updateVisible);
      window.removeEventListener("online", updateVisible);
      document.removeEventListener("visibilitychange", updateVisible);
      pendingRead.current?.abort();
      pendingRead.current = null;
    };
  }, [note, refresh]);

  async function mutate(
    body: (api: ReturnType<typeof apiClient>, current: Note, token: string) => Promise<void>,
  ): Promise<void> {
    const token = currentSessionToken();
    if (
      !note ||
      !token ||
      changing.current ||
      !writingAllowed.current ||
      navigator.onLine === false
    )
      return;
    changing.current = true;
    pendingRead.current?.abort();
    pendingRead.current = null;
    setBusy(true);
    setError(null);
    setMenu(false);
    try {
      await body(apiClient(token), note, token);
    } catch {
      if (currentSessionToken() === token) setError("extra.auth_network_error");
    } finally {
      changing.current = false;
      setBusy(false);
    }
  }

  function toggle(position: number): void {
    void mutate(async (api, current, token) => {
      const ticks = new Set(current.checked_items);
      if (ticks.has(position)) ticks.delete(position);
      else ticks.add(position);
      // spec:impl note-sharing-tags#let-tagged-person-leader-non-leader
      const { data, response } = await api.PUT("/notes/{note_id}/checklist-ticks", {
        params: { path: { note_id: current.id } },
        body: {
          checked_items: [...ticks].sort((left, right) => left - right),
          expected_updated_at: current.updated_at,
          expected_checked_items: current.checked_items,
        },
      });
      if (currentSessionToken() !== token) return;
      if (data) {
        publish(data, !writingAllowed.current || navigator.onLine === false);
      } else if ([401, 403, 404].includes(response.status)) revoke();
      else if (response.status === 409) {
        setError("extra.note_checklist_changed");
        await refresh();
      } else setError("extra.auth_request_failed");
    });
  }

  function reply(): void {
    void mutate(async (api, current, token) => {
      const attempt = replyAttempt.current ?? {
        text: t("note.reply_first_line", {
          [language === "ru" ? "заголовок" : "title"]: limitNoteText(
            singleNoteLine(noteTitle(current)),
            200,
          ),
        }),
        key: crypto.randomUUID(),
      };
      replyAttempt.current = attempt;
      // spec:impl note-sharing-tags#create-reply-new-note-owned
      const { data, error, response } = await api.POST("/notes/{note_id}/replies", {
        params: {
          path: { note_id: current.id },
          header: { "Idempotency-Key": attempt.key },
        },
        body: { text: attempt.text },
      });
      if (currentSessionToken() !== token) return;
      if (response.status < 500) replyAttempt.current = null;
      if (data) {
        void offlineCache(currentSessionToken).then((cache) => cache?.saveNote(data));
        router.push(noteHref(data.id));
      } else if ([401, 403, 404].includes(response.status)) revoke();
      else
        setError(
          errorCode(error) === "tag_not_allowed"
            ? "extra.note_reply_archived"
            : "extra.auth_request_failed",
        );
    });
  }

  function send(): void {
    if (!note) return;
    setMenu(false);
    setError(null);
    void shareNoteText(note).catch((failure: unknown) => {
      if (!(failure instanceof DOMException && failure.name === "AbortError"))
        setError("extra.auth_request_failed");
    });
  }

  if (!note) return <main className="note-route" aria-busy="true" />;
  return (
    <>
      <NoteFrame
        onMenu={() => setMenu(true)}
        onClose={() => navigate(back)}
        notice={
          <>
            {!online && <OfflineHint className="note-notice" message="extra.note_offline" />}
            {error && (
              <p className="note-notice" role="alert">
                {t(error)}
              </p>
            )}
          </>
        }
        tools={
          // spec:impl note-sharing-tags#show-reply-bottom-received-note
          <button
            type="button"
            className="shell-primary note-reply"
            disabled={!online || busy}
            onClick={reply}
          >
            {t("note.reply")}
          </button>
        }
      >
        {/* spec:impl note-sharing-tags#open-received-note-read-only-recipient */}
        {/* spec:impl note-sharing-tags#reveal-tagged-people-other-tagged */}
        <article className="note-document">
          {note.title && <h1 className="note-title">{note.title}</h1>}
          <div className="note-author">
            <NoteAccountAvatar name={note.author.name} photoUrl={note.author.photo_url} />
            <span>{note.author.name}</span>
          </div>
          <ChecklistText
            text={note.text}
            personalTicks={note.checked_items}
            disabled={!online || busy}
            onToggle={toggle}
          />
        </article>
      </NoteFrame>
      {/* spec:impl note-editor#show-delete-received-note */}
      {menu && (
        <NoteMenu
          onReply={reply}
          onShare={send}
          onClose={() => setMenu(false)}
          unavailable={!online || busy}
        />
      )}
    </>
  );
}
