"use client";

import type { ReactElement } from "react";
import { NotesGrid } from "@/components/notes/grid/NotesGrid";
import { NotesLoadError } from "@/components/notes/grid/NotesScreen";
import { useClientNotes } from "@/components/notes/grid/notes-data";
import { useAppNavigation } from "@/components/shell/navigation";
import { useTranslation } from "@/lib/i18n";
import { clientNotesHref, folderPath, noteHref } from "@/lib/notes-navigation";

export function NotesBlock({ clientId }: { clientId: string }): ReactElement {
  const t = useTranslation();
  const navigate = useAppNavigation();
  const notes = useClientNotes(clientId);

  return (
    <section className="client-block">
      <h2>{t("notes.title")}</h2>
      {notes.error ? (
        <NotesLoadError error={notes.error} retry={notes.retry} />
      ) : notes.loading ? (
        <div aria-busy="true" />
      ) : notes.data?.items.length ? (
        <NotesGrid
          folders={[]}
          notes={notes.data.items.slice(0, 3)}
          onOpenNote={(id) => navigate(noteHref(id, { client_id: clientId }))}
          onOpenFolder={(id) => navigate(folderPath(id))}
        />
      ) : (
        <p className="client-hint">{t("extra.notes_no_results")}</p>
      )}
      <button
        className="shell-secondary"
        type="button"
        onClick={() => {
          // spec:impl notes-grid-folders#open-screen-7-1-filtered-one
          navigate(clientNotesHref(clientId));
        }}
      >
        {t("extra.client_all_notes")}
      </button>
    </section>
  );
}
