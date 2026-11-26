"use client";

import { useParams, useSearchParams } from "next/navigation";
import { Suspense, type ReactElement } from "react";
import { NoteDetails } from "@/components/notes/editor/NoteDetails";

function RequestedNote(): ReactElement {
  const { id } = useParams<{ id: string }>();
  const params = useSearchParams();
  return <NoteDetails id={id} params={params} />;
}

export default function NoteDetailsPage(): ReactElement {
  return (
    <Suspense fallback={<main className="note-route" aria-busy="true" />}>
      <RequestedNote />
    </Suspense>
  );
}
