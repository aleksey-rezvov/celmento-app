"use client";

import { useParams, useRouter } from "next/navigation";
import { useState, type ReactElement } from "react";
import { FolderResource } from "@/components/notes/grid/FolderResource";
import { NotesGrid } from "@/components/notes/grid/NotesGrid";
import { NotesLoadError, NotesScreen } from "@/components/notes/grid/NotesScreen";
import { useNotesList } from "@/components/notes/grid/notes-data";
import { ConfirmSheet } from "@/components/shell/ConfirmSheet";
import { EmptyState } from "@/components/shell/EmptyState";
import { Sheet } from "@/components/shell/Sheet";
import { useAppNavigation } from "@/components/shell/navigation";
import { apiClient, type Schemas } from "@/lib/api/client";
import { useTranslation, type MessageKey } from "@/lib/i18n";
import { folderPath, noteHref, notesPath } from "@/lib/notes-navigation";
import { getSessionToken } from "@/lib/session";

function FolderContents({ folder }: { folder: Schemas["Folder"] }): ReactElement {
  const t = useTranslation();
  const router = useRouter();
  const navigate = useAppNavigation();
  const notes = useNotesList({ folderId: folder.id });
  const [menu, setMenu] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);

  async function removeFolder(): Promise<void> {
    if (deleting) return;
    const token = getSessionToken();
    if (!token) return;
    setConfirm(false);
    setDeleting(true);
    setError(null);
    try {
      const { response } = await apiClient(token).DELETE("/folders/{folder_id}", {
        params: { path: { folder_id: folder.id } },
      });
      if (getSessionToken() !== token) return;
      if (response.ok || response.status === 404) router.replace(notesPath);
      else setError("extra.auth_request_failed");
    } catch {
      if (getSessionToken() === token) setError("extra.auth_network_error");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <NotesScreen
      title={folder.name}
      back={notesPath}
      actions={
        <button
          className="shell-icon-button"
          type="button"
          aria-label={t("extra.folder_actions")}
          disabled={deleting}
          onClick={() => setMenu(true)}
        >
          <span aria-hidden="true">…</span>
        </button>
      }
    >
      {error && <NotesLoadError error={error} />}
      {notes.error ? (
        <NotesLoadError error={notes.error} retry={notes.retry} />
      ) : notes.loading ? (
        <div aria-busy="true" />
      ) : notes.data?.items.length ? (
        <NotesGrid
          folders={[]}
          notes={notes.data.items}
          onOpenNote={(id) => navigate(noteHref(id, { folder_id: folder.id }))}
          onOpenFolder={(id) => navigate(folderPath(id))}
        />
      ) : (
        // spec:impl notes-grid-folders#show-folder-empty-calmness-character
        <EmptyState character="notes_folder_empty" textKey="notes.folder_empty" />
      )}
      {menu && (
        <Sheet title={t("extra.folder_actions")} onClose={() => setMenu(false)}>
          <div className="notes-folder-actions">
            <button
              className="shell-primary"
              type="button"
              onClick={() => {
                setMenu(false);
                // spec:impl notes-grid-folders#open-screen-7-5-folder-name
                navigate(folderPath(folder.id) + "/edit");
              }}
            >
              {t("card.edit")}
            </button>
            <button
              className="shell-destructive"
              type="button"
              onClick={() => {
                setMenu(false);
                setConfirm(true);
              }}
            >
              {t("card.delete")}
            </button>
          </div>
        </Sheet>
      )}
      {/* spec:impl notes-grid-folders#ask-folder-delete-folder-name-user */}
      {confirm && (
        <ConfirmSheet
          title={t("card.delete")}
          text={t("notes.folder_delete", { name: folder.name, название: folder.name })}
          confirmLabel={t("card.delete")}
          destructive
          onConfirm={() => void removeFolder()}
          onClose={() => setConfirm(false)}
        />
      )}
    </NotesScreen>
  );
}

export default function FolderPage(): ReactElement {
  const { id } = useParams<{ id: string }>();
  return (
    <FolderResource id={id}>
      {(folder) => <FolderContents key={folder.id} folder={folder} />}
    </FolderResource>
  );
}
