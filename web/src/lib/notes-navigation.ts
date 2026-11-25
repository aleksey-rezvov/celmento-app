export const notesPath = "/app/notes";

const foldersPath = notesPath + "/folders/";
const uuid = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/iu;

export function noteScopeId(value: string | null): string | null {
  return value && uuid.test(value) ? value.toLowerCase() : null;
}

export function folderPath(id: string): string {
  return foldersPath + encodeURIComponent(id);
}

export function folderIdFromPath(pathname: string): string | null {
  return pathname.startsWith(foldersPath) ? noteScopeId(pathname.slice(foldersPath.length)) : null;
}

export function newNoteHref(folderId?: string): string {
  const path = notesPath + "/new";
  return folderId ? path + "?" + new URLSearchParams({ folder_id: folderId }) : path;
}

export function clientNotesHref(clientId: string): string {
  return notesPath + "?" + new URLSearchParams({ client_id: clientId });
}

export function noteHref(
  id: string,
  scope?: { folder_id: string } | { client_id: string },
): string {
  return notesPath + "/" + encodeURIComponent(id) + (scope ? "?" + new URLSearchParams(scope) : "");
}
