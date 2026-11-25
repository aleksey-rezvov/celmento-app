"use client";

import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState, type ReactElement } from "react";
import { NoteResource, NoteUnavailable } from "@/components/notes/editor/NoteResource";
import { NoteRouteHeader } from "@/components/notes/editor/NoteRouteHeader";
import { useNoteOnline } from "@/components/notes/editor/useNoteAutosave";
import { apiClient, type Schemas } from "@/lib/api/client";
import { useTranslation } from "@/lib/i18n";
import { noteContext } from "@/lib/note-route";
import { noteHref } from "@/lib/notes-navigation";
import { getSessionToken } from "@/lib/session";

type Folder = Schemas["Folder"];

function MoveNote({ note, back }: { note: Schemas["Note"]; back: string }): ReactElement {
  const t = useTranslation();
  const router = useRouter();
  const online = useNoteOnline();
  const [folders, setFolders] = useState<Folder[] | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [loadError, setLoadError] = useState(false);
  const [moveError, setMoveError] = useState(false);
  const [busy, setBusy] = useState(false);
  const moving = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    const token = getSessionToken();
    async function load(): Promise<void> {
      try {
        const { data } = await apiClient(token).GET("/folders", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (controller.signal.aborted || getSessionToken() !== token) return;
        if (data) setFolders(data.items);
        else setLoadError(true);
      } catch {
        if (!controller.signal.aborted && getSessionToken() === token) setLoadError(true);
      }
    }
    void load();
    return () => controller.abort();
  }, [attempt]);

  async function move(folderId: string | null): Promise<void> {
    if (moving.current || !navigator.onLine) return;
    const token = getSessionToken();
    if (folderId === note.folder_id) {
      router.replace(back);
      return;
    }
    moving.current = true;
    setBusy(true);
    setMoveError(false);
    try {
      // spec:impl notes-grid-folders#open-list-account-folders-extra
      const { data } = await apiClient(token).PATCH("/notes/{note_id}", {
        params: { path: { note_id: note.id } },
        body: { folder_id: folderId },
      });
      if (getSessionToken() !== token) return;
      if (data) router.replace(back);
      else setMoveError(true);
    } catch {
      if (getSessionToken() === token) setMoveError(true);
    } finally {
      moving.current = false;
      setBusy(false);
    }
  }

  return (
    <main className="note-route">
      <NoteRouteHeader title={t("note.move")} back={back} />
      {!online && <p role="status">{t("extra.note_offline")}</p>}
      {moveError && <p role="alert">{t("extra.auth_request_failed")}</p>}
      {loadError ? (
        <div className="note-route-error">
          <p role="alert">{t("extra.auth_request_failed")}</p>
          <button
            type="button"
            className="shell-secondary"
            onClick={() => {
              setLoadError(false);
              setAttempt(attempt + 1);
            }}
          >
            {t("extra.auth_retry")}
          </button>
        </div>
      ) : !folders ? (
        <div aria-busy="true" />
      ) : (
        <ul className="note-route-list">
          {[{ id: null, name: t("notes.no_folder") }, ...folders].map((folder) => (
            <li key={folder.id ?? "none"}>
              <button
                type="button"
                aria-pressed={note.folder_id === folder.id}
                disabled={!online || busy}
                onClick={() => void move(folder.id)}
              >
                {folder.name}
                <span aria-hidden="true">{note.folder_id === folder.id ? "✓" : "›"}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

function MoveNoteRoute(): ReactElement {
  const { id } = useParams<{ id: string }>();
  const params = useSearchParams();
  return (
    <NoteResource id={id}>
      {(note) => {
        const back = noteHref(id) + noteContext(params, note.folder_id).query;
        // spec:impl notes-grid-folders#move-received-note-account-folders
        return note.can_edit ? (
          <MoveNote key={id} note={note} back={back} />
        ) : (
          <NoteUnavailable back={back} />
        );
      }}
    </NoteResource>
  );
}

export default function MoveNotePage(): ReactElement {
  return (
    <Suspense fallback={<main className="note-route" aria-busy="true" />}>
      <MoveNoteRoute />
    </Suspense>
  );
}
