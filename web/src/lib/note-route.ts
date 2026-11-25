import { folderPath, newNoteHref, noteScopeId, notesPath } from "./notes-navigation";

const createdNoteKey = "celmentoCreatedNote";

export function rememberCreatedNote(owner: string, id: string): void {
  if (window.location.pathname !== newNoteHref()) return;
  const state: unknown = window.history.state;
  window.history.replaceState(
    {
      ...(state && typeof state === "object" ? state : {}),
      [createdNoteKey]: { owner, id },
    },
    "",
  );
}

export function createdNoteFromHistory(owner: string): string | null {
  const state: unknown = window.history.state;
  if (!state || typeof state !== "object" || !(createdNoteKey in state)) return null;
  const note = state[createdNoteKey];
  return note &&
    typeof note === "object" &&
    "owner" in note &&
    note.owner === owner &&
    "id" in note &&
    typeof note.id === "string"
    ? noteScopeId(note.id)
    : null;
}

export function newSourceNotePath(source: "meeting_id" | "client_id", id: string): string {
  return newNoteHref() + "?" + new URLSearchParams({ [source]: id }).toString();
}

export function noteOrigin(folderId: string | null, clientId: string | null): string {
  if (folderId) return folderPath(folderId);
  if (clientId) return "/app/people/clients/" + encodeURIComponent(clientId);
  return notesPath;
}

export function noteContext(
  params: Pick<URLSearchParams, "get">,
  currentFolder: string | null,
): { back: string; query: string } {
  const requested = noteScopeId(params.get("folder_id"));
  const folderId = requested === currentFolder ? requested : null;
  const clientId = noteScopeId(params.get("client_id"));
  const query = folderId
    ? "?folder_id=" + encodeURIComponent(folderId)
    : clientId
      ? "?client_id=" + encodeURIComponent(clientId)
      : "";
  return { back: noteOrigin(folderId, clientId), query };
}
