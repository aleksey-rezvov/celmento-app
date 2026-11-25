import type { ReactElement } from "react";
import type { Schemas } from "@/lib/api/client";
import { FolderTile } from "./FolderTile";
import { NoteTile } from "./NoteTile";
import "./notes-grid.css";

export interface NotesGridProps {
  folders: Schemas["Folder"][];
  notes: Schemas["Note"][];
  onOpenNote: (id: string) => void;
  onOpenFolder: (id: string) => void;
}

export function NotesGrid({
  folders,
  notes,
  onOpenNote,
  onOpenFolder,
}: NotesGridProps): ReactElement {
  return (
    <>
      {folders.length > 0 && (
        <ul className="notes-grid">
          {folders.map((folder) => (
            <li key={folder.id}>
              <FolderTile folder={folder} onOpen={() => onOpenFolder(folder.id)} />
            </li>
          ))}
        </ul>
      )}
      {notes.length > 0 && (
        <ul className="notes-grid">
          {notes.map((note) => (
            <li key={note.id}>
              <NoteTile note={note} onOpen={() => onOpenNote(note.id)} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
