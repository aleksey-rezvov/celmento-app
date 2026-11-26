"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, type ReactElement } from "react";
import { NoteDetails } from "@/components/notes/editor/NoteDetails";
import { NoteUnavailable } from "@/components/notes/editor/NoteResource";
import { noteScopeId } from "@/lib/notes-navigation";

function CachedNote(): ReactElement {
  const params = useSearchParams();
  const id = noteScopeId(params.get("offline_note"));
  return id ? <NoteDetails id={id} params={params} /> : <NoteUnavailable />;
}

export default function OfflineNotePage(): ReactElement {
  return (
    <Suspense fallback={<main className="note-route" aria-busy="true" />}>
      <CachedNote />
    </Suspense>
  );
}
