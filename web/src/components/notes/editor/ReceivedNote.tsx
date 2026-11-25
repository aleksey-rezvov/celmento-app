"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { useAppNavigation } from "@/components/shell/navigation";
import { apiClient, errorCode, type Schemas } from "@/lib/api/client";
import { useLanguage, useTranslation, type MessageKey } from "@/lib/i18n";
import { noteHref, notesPath } from "@/lib/notes-navigation";
import { limitNoteText, noteTitle, singleNoteLine } from "@/lib/note-text";
import { getSessionToken } from "@/lib/session";
import { ChecklistText } from "./ChecklistText";
import { NoteAccountAvatar, NoteMenu, shareNoteText } from "./NoteActions";
import { NoteFrame } from "./NoteFrame";
import { useNoteOnline } from "./useNoteAutosave";

type Note = Schemas["Note"];

interface ReceivedNoteProps {
  initial: Note;
  back: string;
}

export function ReceivedNote({ initial, back }: ReceivedNoteProps): ReactElement {
  const t = useTranslation();
  const language = useLanguage();
  const navigate = useAppNavigation();
  const router = useRouter();
  const online = useNoteOnline();
  const [note, setNote] = useState<Note | null>(initial);
  const [menu, setMenu] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  const changing = useRef(false);
  const pendingRead = useRef<AbortController | null>(null);
  const replyAttempt = useRef<{ text: string; key: string } | null>(null);
  const id = initial.id;

  const revoke = useCallback((): void => {
    // spec:impl note-sharing-tags#close-note-recipient-side-access-removed
    setNote(null);
    router.replace(notesPath + "?access_removed=1");
  }, [router]);

  const refresh = useCallback(async (): Promise<void> => {
    const token = getSessionToken();
    if (!token || !navigator.onLine || pendingRead.current) return;
    const controller = new AbortController();
    pendingRead.current = controller;
    try {
      // spec:impl note-sharing-tags#show-author-changes-tagged-person
      const { data, response } = await apiClient(token).GET("/notes/{note_id}", {
        params: { path: { note_id: id } },
        signal: controller.signal,
        cache: "no-store",
      });
      if (controller.signal.aborted || getSessionToken() !== token) return;
      if (response.status === 404) revoke();
      else if (data) setNote(data);
    } catch {
      // Keep the visible note while the connection recovers.
    } finally {
      if (pendingRead.current === controller) pendingRead.current = null;
    }
  }, [id, revoke]);

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
    body: (api: ReturnType<typeof apiClient>, current: Note) => Promise<void>,
  ): Promise<void> {
    const token = getSessionToken();
    if (!note || !token || changing.current || !navigator.onLine) return;
    changing.current = true;
    pendingRead.current?.abort();
    pendingRead.current = null;
    setBusy(true);
    setError(null);
    setMenu(false);
    try {
      await body(apiClient(token), note);
    } catch {
      if (getSessionToken() === token) setError("extra.auth_network_error");
    } finally {
      changing.current = false;
      setBusy(false);
    }
  }

  function toggle(position: number): void {
    void mutate(async (api, current) => {
      const ticks = new Set(current.checked_items);
      if (ticks.has(position)) ticks.delete(position);
      else ticks.add(position);
      const token = getSessionToken();
      // spec:impl note-sharing-tags#let-tagged-person-leader-non-leader
      const { data, response } = await api.PUT("/notes/{note_id}/checklist-ticks", {
        params: { path: { note_id: current.id } },
        body: {
          checked_items: [...ticks].sort((left, right) => left - right),
          expected_updated_at: current.updated_at,
          expected_checked_items: current.checked_items,
        },
      });
      if (getSessionToken() !== token) return;
      if (data) setNote(data);
      else if (response.status === 404) revoke();
      else if (response.status === 409) {
        setError("extra.note_checklist_changed");
        await refresh();
      } else setError("extra.auth_request_failed");
    });
  }

  function reply(): void {
    void mutate(async (api, current) => {
      const token = getSessionToken();
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
        params: { path: { note_id: current.id }, header: { "Idempotency-Key": attempt.key } },
        body: { text: attempt.text },
      });
      if (getSessionToken() !== token) return;
      if (response.status < 500) replyAttempt.current = null;
      if (data) router.push(noteHref(data.id));
      else if (response.status === 404) revoke();
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
            {!online && (
              <p className="note-notice" role="status">
                {t("extra.note_offline")}
              </p>
            )}
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
