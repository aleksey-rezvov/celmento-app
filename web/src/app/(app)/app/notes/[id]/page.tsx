"use client";

import { useParams, useSearchParams } from "next/navigation";
import { Suspense, type ReactElement } from "react";
import { NoteEditor } from "@/components/notes/editor/NoteEditor";
import { NoteResource } from "@/components/notes/editor/NoteResource";
import { noteContext } from "@/lib/note-route";

function NoteDetails(): ReactElement {
  const { id } = useParams<{ id: string }>();
  const params = useSearchParams();
  return (
    <NoteResource id={id}>
      {(note) => {
        const { back, query } = noteContext(params, note.can_edit ? note.folder_id : null);
        return <NoteEditor key={note.id} initial={note} back={back} context={query} />;
      }}
    </NoteResource>
  );
}

export default function NoteDetailsPage(): ReactElement {
  return (
    <Suspense fallback={<main className="note-route" aria-busy="true" />}>
      <NoteDetails />
    </Suspense>
  );
}
