import { noteScopeId, notesPath } from "./notes-navigation";

const offlinePagePattern =
  /^\/app(?:\/meetings|\/people|\/notes(?:\/offline|\/(?:folders\/)?[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12})?)?$/iu;

export function isOfflinePage(pathname: string): boolean {
  return offlinePagePattern.test(pathname);
}

export function offlinePageTarget(href: string): URL | null {
  if (navigator.onLine || !navigator.serviceWorker?.controller) {
    return null;
  }

  const target = new URL(href, window.location.href);
  if (target.origin !== window.location.origin || !isOfflinePage(target.pathname)) {
    return null;
  }

  const noteId = target.pathname.startsWith(notesPath + "/")
    ? noteScopeId(target.pathname.slice(notesPath.length + 1))
    : null;
  if (!noteId) {
    return target;
  }

  const offline = new URL(notesPath + "/offline", target.origin);
  offline.searchParams.set("offline_note", noteId);
  for (const context of ["folder_id", "client_id"]) {
    const id = noteScopeId(target.searchParams.get(context));
    if (id) {
      offline.searchParams.set(context, id);
    }
  }
  return offline;
}
