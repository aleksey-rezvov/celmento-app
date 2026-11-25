import type { ReactElement } from "react";
import type { Schemas } from "@/lib/api/client";
import { useTranslation } from "@/lib/i18n";
import { noteScopeId, notesPath } from "@/lib/notes-navigation";
import { NotesLoadError, NotesScreen } from "./NotesScreen";
import { useFolders } from "./notes-data";

interface FolderResourceProps {
  id: string;
  children: (folder: Schemas["Folder"]) => ReactElement;
}

export function FolderResource({ id, children }: FolderResourceProps): ReactElement {
  const t = useTranslation();
  const folderId = noteScopeId(id);
  const folders = useFolders(folderId !== null);
  const folder = folders.data?.items.find((item) => item.id === folderId);

  if (folder) return children(folder);

  return (
    <NotesScreen title={t("notes.title")} back={notesPath}>
      {folders.loading ? (
        <div aria-busy="true" />
      ) : (
        <NotesLoadError
          error={folders.error ?? "extra.notes_no_results"}
          retry={folders.error ? folders.retry : undefined}
        />
      )}
    </NotesScreen>
  );
}
