"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { apiClient, errorCode, type Schemas } from "@/lib/api/client";
import type { MessageKey } from "@/lib/i18n";
import { rememberCreatedNote } from "@/lib/note-route";
import { getSessionToken } from "@/lib/session";

type Note = Schemas["Note"];
export type NoteDraft = Pick<Note, "title" | "text">;
type Revisions = Record<keyof NoteDraft, number>;
type Attempt = { body: Schemas["NoteCreate"]; key: string; revisions: Revisions };
type Saved = Note | null | false;

function subscribeOnline(listener: () => void): () => void {
  window.addEventListener("online", listener);
  window.addEventListener("offline", listener);
  return () => {
    window.removeEventListener("online", listener);
    window.removeEventListener("offline", listener);
  };
}

export function useNoteOnline(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
}

export function hasNoteContent(draft: NoteDraft, firstLine: string): boolean {
  return Boolean(draft.title || (draft.text && draft.text !== firstLine));
}

function needsSave(draft: NoteDraft, note: Note | null, firstLine: string): boolean {
  return note
    ? draft.title !== note.title || draft.text !== note.text
    : hasNoteContent(draft, firstLine);
}

function changes(draft: NoteDraft, note: Note): Partial<NoteDraft> {
  return {
    ...(draft.title !== note.title ? { title: draft.title } : {}),
    ...(draft.text !== note.text ? { text: draft.text } : {}),
  };
}

interface NoteAutosave {
  note: Note | null;
  draft: NoteDraft;
  dirty: boolean;
  error: MessageKey | null;
  online: boolean;
  flush: () => Promise<Saved>;
  change: (patch: Partial<NoteDraft>) => void;
  accept: (note: Note) => void;
}

export function useNoteAutosave(
  owner: string,
  initial: Note | null,
  firstLine: string,
  folderId: string | null,
): NoteAutosave {
  const online = useNoteOnline();
  const [note, setNote] = useState(initial);
  const [draft, setDraft] = useState<NoteDraft>(() => ({
    title: initial?.title ?? "",
    text: initial?.text ?? firstLine,
  }));
  const [error, setError] = useState<MessageKey | null>(null);
  const [creationPending, setCreationPending] = useState(false);
  const desired = useRef(draft);
  const revisions = useRef<Revisions>({ title: 0, text: 0 });
  const stored = useRef(note);
  const creation = useRef<Attempt | null>(null);
  const request = useRef<Promise<Saved> | null>(null);
  const mounted = useRef(false);
  const dirty = creationPending || needsSave(draft, note, firstLine);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const accept = useCallback((next: Note, sent: Revisions = revisions.current): void => {
    // A newer edit wins only for the field the author touched during the request.
    const rebased = {
      title: revisions.current.title === sent.title ? next.title : desired.current.title,
      text: revisions.current.text === sent.text ? next.text : desired.current.text,
    };
    stored.current = next;
    desired.current = rebased;
    setNote(next);
    setDraft(rebased);
  }, []);

  const change = (patch: Partial<NoteDraft>): void => {
    const next = { ...desired.current, ...patch };
    revisions.current = {
      title: revisions.current.title + Number(next.title !== desired.current.title),
      text: revisions.current.text + Number(next.text !== desired.current.text),
    };
    desired.current = next;
    setDraft(next);
    setError(null);
  };

  const flush = useCallback((): Promise<Saved> => {
    if (request.current) return request.current;
    if (!creation.current && !needsSave(desired.current, stored.current, firstLine)) {
      return Promise.resolve(stored.current);
    }
    const token = getSessionToken();
    if (!token || !navigator.onLine) return Promise.resolve(false);

    async function write(): Promise<Saved> {
      setError(null);
      try {
        const api = apiClient(token);
        // spec:impl note-editor#save-note-automatically-user-types
        while (
          mounted.current &&
          getSessionToken() === token &&
          (creation.current || needsSave(desired.current, stored.current, firstLine))
        ) {
          if (!navigator.onLine) return false;
          const current = stored.current;
          let sent = revisions.current;
          let result;
          if (current) {
            result = await api.PATCH("/notes/{note_id}", {
              params: { path: { note_id: current.id } },
              body: changes(desired.current, current),
            });
          } else {
            // Keep the first payload and key together until its result is known.
            const attempt = creation.current ?? {
              body: { ...desired.current, folder_id: folderId },
              key: crypto.randomUUID(),
              revisions: sent,
            };
            creation.current = attempt;
            sent = attempt.revisions;
            setCreationPending(true);
            result = await api.POST("/notes", {
              params: { header: { "Idempotency-Key": attempt.key } },
              body: attempt.body,
            });
          }
          if (!mounted.current || getSessionToken() !== token) return false;
          if (!result.data) {
            if (!current && result.response.status < 500) {
              creation.current = null;
              setCreationPending(false);
            }
            setError(
              errorCode(result.error) === "note_too_long"
                ? "note.too_long"
                : "extra.auth_request_failed",
            );
            return false;
          }
          creation.current = null;
          setCreationPending(false);
          accept(result.data, sent);
          if (!current) rememberCreatedNote(owner, result.data.id);
        }
        return mounted.current && getSessionToken() === token ? stored.current : false;
      } catch {
        if (mounted.current && getSessionToken() === token) setError("extra.auth_network_error");
        return false;
      }
    }

    const pending = write();
    request.current = pending;
    void pending.then(() => {
      if (request.current === pending) request.current = null;
    });
    return pending;
  }, [accept, firstLine, folderId, owner]);

  useEffect(() => {
    if (!online || !dirty || error !== null) return;
    const timer = window.setTimeout(() => void flush(), 400);
    return () => window.clearTimeout(timer);
  }, [dirty, draft, error, flush, online]);

  return { note, draft, dirty, error, online, flush, change, accept };
}
