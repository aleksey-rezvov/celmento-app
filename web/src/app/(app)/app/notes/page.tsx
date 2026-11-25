"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useId, useState, type ReactElement } from "react";
import { clientPath } from "@/components/clients/card/ClientCardScreen";
import { NoteFilterChips } from "@/components/notes/grid/NoteFilterChips";
import { NotesGrid } from "@/components/notes/grid/NotesGrid";
import { NotesLoadError, NotesScreen } from "@/components/notes/grid/NotesScreen";
import { NotesSearch, NotesSearchButton } from "@/components/notes/grid/NotesSearch";
import { useFolders, useNotesList } from "@/components/notes/grid/notes-data";
import { EmptyState } from "@/components/shell/EmptyState";
import { Sheet } from "@/components/shell/Sheet";
import { useAppNavigation } from "@/components/shell/navigation";
import { useAccount } from "@/lib/account";
import type { Schemas } from "@/lib/api/client";
import { useTranslation } from "@/lib/i18n";
import { folderPath, newNoteHref, noteHref, noteScopeId, notesPath } from "@/lib/notes-navigation";

function NotesIndex({
  clientParam,
  removed,
}: {
  clientParam: string | null;
  removed: boolean;
}): ReactElement {
  const { account } = useAccount();
  const navigate = useAppNavigation();
  const t = useTranslation();
  const searchId = useId();
  const [search, setSearch] = useState<string | null>(null);
  const [filter, setFilter] = useState<Schemas["NoteFilter"]>("all");
  const [menu, setMenu] = useState(false);
  const [accessRemoved, setAccessRemoved] = useState(removed);
  const clientId = account.activated ? (noteScopeId(clientParam) ?? undefined) : undefined;
  const clientView = clientParam !== null;
  const validScope = !clientView || clientId !== undefined;
  const query = search?.trim() || undefined;
  const showFolders = !clientView && !query && filter !== "shared";
  const folderRequest = useFolders(showFolders);
  const noteRequest = useNotesList({ filter, clientId, query, enabled: validScope });
  const folders = folderRequest.data?.items ?? [];
  const notes = noteRequest.data?.items ?? [];
  const title = t("notes.title");
  const error = !validScope ? "extra.notes_no_results" : (noteRequest.error ?? folderRequest.error);
  const retry = validScope
    ? noteRequest.error
      ? noteRequest.retry
      : folderRequest.retry
    : undefined;
  const loading = folderRequest.loading || noteRequest.loading;
  const rootEmpty = !clientView && !query && filter !== "shared" && noteRequest.data?.total === 0;
  const back = clientView ? (clientId ? clientPath(clientId) : notesPath) : undefined;

  useEffect(() => {
    if (!removed) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("access_removed") !== "1") return;
    url.searchParams.delete("access_removed");
    window.history.replaceState(window.history.state, "", url);
  }, [removed]);

  // spec:impl notes-grid-folders#open-notes-tab-screen-7-1
  // spec:impl notes-grid-folders#split-notes-role-show-separate
  return (
    <NotesScreen
      title={title}
      back={back}
      actions={
        validScope ? (
          <>
            <NotesSearchButton
              controls={searchId}
              open={search !== null}
              onToggle={() => setSearch((value) => (value === null ? "" : null))}
            />
            {!clientView && (
              <button
                className="shell-icon-button"
                type="button"
                aria-label={t("extra.notes_actions")}
                onClick={() => setMenu(true)}
              >
                <span aria-hidden="true">…</span>
              </button>
            )}
          </>
        ) : undefined
      }
    >
      {accessRemoved && (
        <div className="notes-access-removed">
          <p role="status">{t("note.access_removed")}</p>
          <button
            className="shell-icon-button"
            type="button"
            aria-label={t("extra.notice_dismiss")}
            onClick={() => setAccessRemoved(false)}
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>
      )}
      {search !== null && <NotesSearch id={searchId} value={search} onChange={setSearch} />}
      {/* spec:impl notes-grid-folders#offer-filter-all-mine-shared-with-me */}
      {validScope && !query && <NoteFilterChips value={filter} onChange={setFilter} />}
      {error ? (
        <NotesLoadError error={error} retry={retry} />
      ) : loading ? (
        <div aria-busy="true" />
      ) : (
        <>
          <NotesGrid
            folders={folders}
            notes={notes}
            onOpenFolder={(id) => navigate(folderPath(id))}
            onOpenNote={(id) => {
              // spec:impl notes-grid-folders#open-note-screen-7-2-tile
              navigate(noteHref(id, clientId ? { client_id: clientId } : undefined));
            }}
          />
          {/* spec:impl notes-grid-folders#show-empty-calmness-character-one */}
          {rootEmpty ? (
            <EmptyState
              character="notes_empty"
              textKey="notes.empty"
              action={{ labelKey: "extra.note_create", href: newNoteHref() }}
            />
          ) : notes.length !== 0 || folders.length !== 0 ? null : !query && filter === "shared" ? (
            // spec:impl notes-grid-folders#show-empty-shared-calmness-character
            <EmptyState character="notes_empty_shared" textKey="notes.empty_shared" />
          ) : (
            <p>{t("extra.notes_no_results")}</p>
          )}
        </>
      )}
      {menu && (
        <Sheet title={t("extra.notes_actions")} onClose={() => setMenu(false)}>
          <button
            className="shell-primary"
            type="button"
            onClick={() => {
              setMenu(false);
              // spec:impl notes-grid-folders#open-screen-7-5-new-folder-menu
              navigate(notesPath + "/folders/new");
            }}
          >
            {t("notes.new_folder")}
          </button>
        </Sheet>
      )}
    </NotesScreen>
  );
}

function NotesRoute(): ReactElement {
  const query = useSearchParams();
  const clientParam = query.get("client_id");
  return (
    <NotesIndex
      key={clientParam ?? "root"}
      clientParam={clientParam}
      removed={query.get("access_removed") === "1"}
    />
  );
}

export default function Notes(): ReactElement {
  return (
    <Suspense fallback={<main aria-busy="true" />}>
      <NotesRoute />
    </Suspense>
  );
}
