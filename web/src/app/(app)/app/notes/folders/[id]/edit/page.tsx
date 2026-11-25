"use client";

import { useParams } from "next/navigation";
import type { ReactElement } from "react";
import { FolderForm } from "@/components/notes/grid/FolderForm";
import { FolderResource } from "@/components/notes/grid/FolderResource";

export default function EditFolderPage(): ReactElement {
  const { id } = useParams<{ id: string }>();
  return (
    <FolderResource id={id}>
      {(folder) => <FolderForm key={folder.id} folder={folder} />}
    </FolderResource>
  );
}
