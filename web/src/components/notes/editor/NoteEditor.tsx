"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { OfflineHint } from "@/components/OfflineHint";
import { Sheet } from "@/components/shell/Sheet";
import { useAppNavigation, useNavigationGuard } from "@/components/shell/navigation";
import { useAccount } from "@/lib/account";
import { apiClient, type Schemas } from "@/lib/api/client";
import { useTranslation } from "@/lib/i18n";
import { noteHref } from "@/lib/notes-navigation";
import {
  formatNoteSelection,
  limitNoteText,
  toggleAuthorItem,
  type NoteFormat,
} from "@/lib/note-text";
import { offlineCache } from "@/lib/offline-cache";
import { ChecklistText } from "./ChecklistText";
import { FormattingBar } from "./FormattingBar";
import { NoteFrame } from "./NoteFrame";
import { NoteMenu, shareNoteText, TaggedAvatars } from "./NoteActions";
import { ReceivedNote } from "./ReceivedNote";
import { hasNoteContent, useNoteAutosave } from "./useNoteAutosave";

type Note = Schemas["Note"];
type Tag = Schemas["NoteTag"];

interface NoteEditorProps {
  initial?: Note;
  firstLine?: string;
  folderId?: string | null;
  back: string;
  context?: string;
  readOnly?: boolean;
}

export function NoteEditor(props: NoteEditorProps): ReactElement {
  return props.initial && !props.initial.can_edit ? (
    <ReceivedNote initial={props.initial} back={props.back} readOnly={props.readOnly} />
  ) : (
    <OwnedNote {...props} />
  );
}

function OwnedNote({
  initial,
  firstLine = "",
  folderId = null,
  back,
  context = "",
  readOnly = false,
}: NoteEditorProps): ReactElement {
  const t = useTranslation();
  const { account, currentSessionToken } = useAccount();
  const navigate = useAppNavigation();
  const router = useRouter();
  const { note, draft, dirty, error, online, flush, change, accept } = useNoteAutosave(
    account.id,
    initial ?? null,
    firstLine,
    folderId,
    readOnly,
  );
  const [menu, setMenu] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [tag, setTag] = useState<Tag | null>(null);
  const [working, setWorking] = useState(false);
  const [actionError, setActionError] = useState(false);
  const [leave, setLeave] = useState<(() => void) | null>(null);
  const [tooLong, setTooLong] = useState(false);
  const [editing, setEditing] = useState(false);
  const [showFormat, setShowFormat] = useState(true);
  const field = useRef<HTMLTextAreaElement>(null);
  const title = useRef<HTMLTextAreaElement>(null);
  const selection = useRef<{ start: number; end: number } | null>(null);
  const operation = useRef(false);
  const writable = online && !working;
  const empty = !hasNoteContent(draft, firstLine);
  const blankNote = !initial && empty && note !== null;

  useEffect(() => {
    if (!initial && navigator.onLine) title.current?.focus();
  }, [initial]);

  const finish = useCallback(
    async (proceed: () => void): Promise<void> => {
      if (operation.current) return;
      operation.current = true;
      setWorking(true);
      setActionError(false);
      try {
        const saved = await flush();
        if (saved === false) {
          setLeave(() => proceed);
          return;
        }
        // spec:impl note-editor#keep-note-closed-empty-title
        if (!initial && saved && !hasNoteContent(saved, firstLine)) {
          const token = currentSessionToken();
          if (!token || !online || navigator.onLine === false) {
            setLeave(() => proceed);
            return;
          }
          const { response } = await apiClient(token).DELETE("/notes/{note_id}", {
            params: { path: { note_id: saved.id } },
          });
          if (currentSessionToken() !== token) return;
          if (response.status !== 204 && response.status !== 404) {
            setActionError(true);
            return;
          }
          const cache = await offlineCache(currentSessionToken);
          cache?.removeNote(saved.id);
        }
        proceed();
      } catch {
        setActionError(true);
      } finally {
        operation.current = false;
        setWorking(false);
      }
    },
    [currentSessionToken, firstLine, flush, initial, online],
  );

  const guard = useCallback(
    (proceed: () => void): void => {
      void finish(proceed);
    },
    [finish],
  );
  useNavigationGuard(dirty || blankNote || working ? guard : null);
  useEffect(() => {
    if (!dirty && !blankNote && !working) return;
    const warn = (event: BeforeUnloadEvent): void => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, blankNote, working]);

  async function openScreen(screen: "tag" | "move"): Promise<void> {
    if (operation.current || !writable) return;
    operation.current = true;
    setWorking(true);
    setMenu(false);
    setActionError(false);
    try {
      const saved = await flush();
      if (!saved) return;
      const href = noteHref(saved.id) + "/" + screen + context;
      if (initial) router.push(href);
      else router.replace(href);
    } finally {
      operation.current = false;
      setWorking(false);
    }
  }

  async function removeNote(): Promise<void> {
    const token = currentSessionToken();
    if (!token || operation.current || !online || navigator.onLine === false) return;
    operation.current = true;
    setWorking(true);
    setActionError(false);
    try {
      const saved = await flush();
      if (saved === false || currentSessionToken() !== token || !navigator.onLine) return;
      if (saved) {
        // spec:impl note-editor#ask-delete-confirm-after-delete
        const { response } = await apiClient(token).DELETE("/notes/{note_id}", {
          params: { path: { note_id: saved.id } },
        });
        if (currentSessionToken() !== token) return;
        if (response.status !== 204 && response.status !== 404) {
          setActionError(true);
          return;
        }
        const cache = await offlineCache(currentSessionToken);
        cache?.removeNote(saved.id);
      }
      if (currentSessionToken() !== token) return;
      router.replace(back);
    } catch {
      setActionError(true);
    } finally {
      operation.current = false;
      setWorking(false);
    }
  }

  async function removeAccess(selected: Tag): Promise<void> {
    const token = currentSessionToken();
    if (!token || !note || operation.current || !writable || navigator.onLine === false) return;
    operation.current = true;
    setWorking(true);
    setActionError(false);
    try {
      const saved = await flush();
      if (!saved || currentSessionToken() !== token || !navigator.onLine) return;
      const api = apiClient(token);
      // spec:impl note-sharing-tags#offer-remove-access-author-taps-tagged
      const { response } = await api.DELETE("/notes/{note_id}/tags/{tag_id}", {
        params: { path: { note_id: saved.id, tag_id: selected.id } },
      });
      if (currentSessionToken() !== token) return;
      if (response.status !== 204 && response.status !== 404) {
        setActionError(true);
        return;
      }
      accept({
        ...saved,
        tags: saved.tags.filter(({ id }) => id !== selected.id),
      });
      setTag(null);
      const result = await api.GET("/notes/{note_id}", {
        params: { path: { note_id: saved.id } },
        cache: "no-store",
      });
      if (currentSessionToken() === token && result.data) accept(result.data);
    } catch {
      setActionError(true);
    } finally {
      operation.current = false;
      setWorking(false);
    }
  }

  function sendText(): void {
    setMenu(false);
    setActionError(false);
    void flush();
    void shareNoteText(draft).catch((failure: unknown) => {
      if (!(failure instanceof DOMException && failure.name === "AbortError")) setActionError(true);
    });
  }

  function changeText(value: string): boolean {
    // spec:impl note-editor#stop-accepting-text-after-20-000-characters
    const text = limitNoteText(value, 20_000);
    setTooLong(text !== value);
    change({ text });
    return text === value;
  }

  function focusText(start: number, end = start): void {
    setEditing(true);
    window.requestAnimationFrame(() => {
      field.current?.focus();
      field.current?.setSelectionRange(start, end);
    });
  }

  function formatText(format: NoteFormat): void {
    const position = field.current
      ? { start: field.current.selectionStart, end: field.current.selectionEnd }
      : (selection.current ?? {
          start: draft.text.length,
          end: draft.text.length,
        });
    const next = formatNoteSelection(draft.text, position.start, position.end, format);
    if (changeText(next.text)) focusText(next.start, next.end);
  }

  const status =
    dirty && !error && online ? t("note.saving") : !dirty && note ? t("note.saved") : undefined;
  const problem = error ?? (actionError ? "extra.auth_request_failed" : null);
  const editable = (editing && writable) || !draft.text;
  const close = (): void => {
    if (initial) navigate(back);
    else void finish(() => router.replace(back));
  };

  return (
    <>
      <NoteFrame
        status={status}
        onMenu={() => setMenu(true)}
        onClose={close}
        notice={
          <>
            {!online && <OfflineHint className="note-notice" message="extra.note_offline" />}
            {tooLong && (
              <p className="note-notice" role="alert">
                {t("note.too_long")}
              </p>
            )}
            {problem && !menu && !deleting && !tag && (
              <div className="note-notice" role="alert">
                {t(problem)}
                {error && online && (
                  <button type="button" onClick={() => void flush()}>
                    {t("extra.auth_retry")}
                  </button>
                )}
              </div>
            )}
          </>
        }
        tools={
          <>
            <button
              type="button"
              className="note-tool"
              aria-label={t("note.delete")}
              disabled={!writable}
              onClick={() => setDeleting(true)}
            >
              <span aria-hidden="true">🗑︎</span>
            </button>
            {writable && (
              <button
                type="button"
                className="note-format-toggle"
                aria-controls="note-format"
                aria-label={t("extra.note_formatting")}
                aria-expanded={showFormat}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => setShowFormat(!showFormat)}
              >
                <span aria-hidden="true">{showFormat ? "⌄" : "⌃"}</span>
              </button>
            )}
          </>
        }
        format={writable && showFormat ? <FormattingBar onFormat={formatText} /> : undefined}
      >
        <div className="note-document">
          {/* spec:impl note-editor#open-empty-note-screen-7-2 */}
          {/* spec:impl note-editor#open-existing-note-account-screen */}
          <textarea
            ref={title}
            className="note-title"
            rows={1}
            value={draft.title}
            readOnly={!writable}
            aria-label={t("note.title_placeholder")}
            placeholder={t("note.title_placeholder")}
            onChange={(event) => {
              // spec:impl note-editor#limit-title-200-characters
              change({ title: limitNoteText(event.currentTarget.value, 200) });
            }}
          />
          {note && <TaggedAvatars tags={note.tags} onPick={setTag} disabled={!writable} />}
          {editable ? (
            <textarea
              className="note-body"
              ref={field}
              rows={8}
              value={draft.text}
              readOnly={!writable}
              aria-label={t("note.text_placeholder")}
              placeholder={t("note.text_placeholder")}
              onFocus={() => setEditing(true)}
              onChange={(event) => changeText(event.currentTarget.value)}
              onBlur={(event) => {
                selection.current = {
                  start: event.currentTarget.selectionStart,
                  end: event.currentTarget.selectionEnd,
                };
                setEditing(false);
              }}
            />
          ) : (
            <div
              className="note-body-preview"
              tabIndex={writable ? 0 : undefined}
              aria-label={t("note.text_placeholder")}
              onKeyDown={(event) => {
                if (!writable || event.target !== event.currentTarget || event.key !== "Enter")
                  return;
                event.preventDefault();
                focusText(draft.text.length);
              }}
              onClick={(event) => {
                if (
                  writable &&
                  event.target instanceof Element &&
                  !event.target.closest("a, input, label, button")
                ) {
                  focusText(draft.text.length);
                }
              }}
            >
              {/* spec:impl note-editor#toggle-checklist-item-author-taps */}
              <ChecklistText
                text={draft.text}
                disabled={!writable}
                onToggle={(position) => change({ text: toggleAuthorItem(draft.text, position) })}
              />
            </div>
          )}
        </div>
      </NoteFrame>
      {menu && (
        <NoteMenu
          canTag={account.activated}
          unavailable={!writable}
          onTag={empty ? undefined : () => void openScreen("tag")}
          onMove={empty ? undefined : () => void openScreen("move")}
          onDelete={() => {
            setMenu(false);
            setDeleting(true);
          }}
          onShare={sendText}
          onClose={() => setMenu(false)}
        />
      )}
      {deleting && (
        <Sheet title={t("note.delete_confirm")} onClose={() => !working && setDeleting(false)}>
          <div className="note-actions">
            {problem && <p role="alert">{t(problem)}</p>}
            <button
              type="button"
              className="shell-destructive"
              disabled={!writable}
              onClick={() => void removeNote()}
            >
              {t("note.delete")}
            </button>
            <button
              type="button"
              className="shell-secondary"
              disabled={working}
              onClick={() => setDeleting(false)}
            >
              {t("share.cancel")}
            </button>
          </div>
        </Sheet>
      )}
      {tag && (
        <Sheet title={tag.name} onClose={() => !working && setTag(null)}>
          <div className="note-actions">
            {problem && <p role="alert">{t(problem)}</p>}
            <button
              type="button"
              className="shell-destructive"
              disabled={!writable}
              onClick={() => void removeAccess(tag)}
            >
              {t("note.remove_access")}
            </button>
          </div>
        </Sheet>
      )}
      {leave && (
        <Sheet title={t("profile.unsaved")} onClose={() => setLeave(null)}>
          <div className="note-actions">
            <button
              type="button"
              className="shell-secondary"
              disabled={!online || working}
              onClick={() => {
                setLeave(null);
                void finish(leave);
              }}
            >
              {t("extra.auth_retry")}
            </button>
            <button
              type="button"
              className="shell-destructive"
              onClick={() => {
                setLeave(null);
                leave();
              }}
            >
              {t("profile.dont_save")}
            </button>
          </div>
        </Sheet>
      )}
    </>
  );
}
