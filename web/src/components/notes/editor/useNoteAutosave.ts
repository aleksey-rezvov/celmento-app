"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useAccount } from "@/lib/account";
import { apiClient, errorCode, type Schemas } from "@/lib/api/client";
import type { MessageKey } from "@/lib/i18n";
import { rememberCreatedNote } from "@/lib/note-route";
import { offlineCache } from "@/lib/offline-cache";
import { useOnline } from "@/lib/online";

type Note = Schemas["Note"];
export type NoteDraft = Pick<Note, "title" | "text">;
type Revisions = Record<keyof NoteDraft, number>;
type Attempt = {
  body: Schemas["NoteCreate"];
  key: string;
  revisions: Revisions;
};
type Saved = Note | null | false;

function noteVersion(timestamp: string): number {
  const extraPrecision = /\.\d{3}(\d{1,3})/u.exec(timestamp)?.[1] ?? "";
  return Date.parse(timestamp) * 1000 + Number(extraPrecision.padEnd(3, "0"));
}

export function compareNoteVersions(left: Note, right: Note): number {
  return noteVersion(left.updated_at) - noteVersion(right.updated_at);
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
  readOnly: boolean,
): NoteAutosave {
  const { currentSessionToken } = useAccount();
  const [appliedInitial, setAppliedInitial] = useState(initial);
  const online = useOnline() && !readOnly && initial === appliedInitial;
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
  const writingAllowed = useRef(false);
  const mounted = useRef(false);
  const dirty = creationPending || needsSave(draft, note, firstLine);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useLayoutEffect(() => {
    writingAllowed.current = online;
  }, [online]);

  const publish = useCallback(
    (saved: Note, rebased: NoteDraft): void => {
      stored.current = saved;
      desired.current = rebased;
      setNote(saved);
      setDraft(rebased);
      void offlineCache(currentSessionToken).then((cache) => cache?.saveNote(saved));
    },
    [currentSessionToken],
  );

  const accept = useCallback(
    (next: Note, sent: Revisions = revisions.current): void => {
      const baseline = stored.current;
      const authoritative = baseline && compareNoteVersions(next, baseline) < 0 ? baseline : next;
      // A receipt acknowledges the sent edits even if a fresher read already arrived.
      publish(authoritative, {
        title: revisions.current.title === sent.title ? authoritative.title : desired.current.title,
        text: revisions.current.text === sent.text ? authoritative.text : desired.current.text,
      });
    },
    [publish],
  );

  useEffect(() => {
    if (initial === appliedInitial) return;
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      if (initial) {
        const baseline = stored.current;
        const authoritative =
          baseline && compareNoteVersions(initial, baseline) < 0 ? baseline : initial;
        publish(authoritative, {
          title:
            baseline && desired.current.title !== baseline.title
              ? desired.current.title
              : authoritative.title,
          text:
            baseline && desired.current.text !== baseline.text
              ? desired.current.text
              : authoritative.text,
        });
        setError((previous) => (previous === "extra.auth_network_error" ? null : previous));
      }
      setAppliedInitial(initial);
    });
    return () => {
      active = false;
    };
  }, [appliedInitial, initial, publish]);

  const change = (patch: Partial<NoteDraft>): void => {
    if (!online || navigator.onLine === false) return;
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
    const token = currentSessionToken();
    if (!token || !writingAllowed.current || navigator.onLine === false)
      return Promise.resolve(false);

    async function write(): Promise<Saved> {
      setError(null);
      try {
        const api = apiClient(token);
        // spec:impl note-editor#save-note-automatically-user-types
        while (
          mounted.current &&
          currentSessionToken() === token &&
          (creation.current || needsSave(desired.current, stored.current, firstLine))
        ) {
          if (!writingAllowed.current || navigator.onLine === false) return false;
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
          if (!mounted.current || currentSessionToken() !== token) return false;
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
        return mounted.current && currentSessionToken() === token ? stored.current : false;
      } catch {
        if (mounted.current && currentSessionToken() === token)
          setError("extra.auth_network_error");
        return false;
      }
    }

    const pending = write();
    request.current = pending;
    void pending.then(() => {
      if (request.current === pending) request.current = null;
    });
    return pending;
  }, [accept, currentSessionToken, firstLine, folderId, owner]);

  useEffect(() => {
    if (!online || !dirty || error !== null) return;
    const timer = window.setTimeout(() => void flush(), 400);
    return () => window.clearTimeout(timer);
  }, [dirty, draft, error, flush, online]);

  return { note, draft, dirty, error, online, flush, change, accept };
}
