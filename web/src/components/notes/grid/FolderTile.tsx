import type { ReactElement } from "react";
import type { Schemas } from "@/lib/api/client";

export function FolderTile({
  folder,
  onOpen,
}: {
  folder: Schemas["Folder"];
  onOpen: () => void;
}): ReactElement {
  return (
    <button
      className="notes-folder-tile"
      type="button"
      data-folder-color={folder.color}
      onClick={onOpen}
    >
      <span>{folder.name}</span>
    </button>
  );
}
