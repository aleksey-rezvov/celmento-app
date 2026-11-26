"use client";

import type { ReactElement } from "react";
import { noteContext } from "@/lib/note-route";
import { NoteEditor } from "./NoteEditor";
import { NoteResource } from "./NoteResource";

interface NoteDetailsProps {
  id: string;
  params: Pick<URLSearchParams, "get">;
}

export function NoteDetails({ id, params }: NoteDetailsProps): ReactElement {
  return (
    <NoteResource id={id} allowOffline>
      {(note, { readOnly }) => {
        const { back, query } = noteContext(params, note.can_edit ? note.folder_id : null);
        return (
          <NoteEditor
            key={note.id}
            initial={note}
            readOnly={readOnly}
            back={back}
            context={query}
          />
        );
      }}
    </NoteResource>
  );
}
