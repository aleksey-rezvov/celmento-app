import { retireOfflineSession } from "./offline-cache";

const SESSION_KEY = "celmento_app_session";
const SESSION_CHANGE = "celmento-session-change";

export function getSessionToken(): string | null {
  return typeof window === "undefined" ? null : window.localStorage.getItem(SESSION_KEY);
}

export function setSessionToken(token: string): void {
  const previous = getSessionToken();
  window.localStorage.setItem(SESSION_KEY, token);
  if (previous && previous !== token) void retireOfflineSession(previous);
  window.dispatchEvent(new Event(SESSION_CHANGE));
}

export function clearSessionToken(expected?: string): void {
  const previous = getSessionToken();
  if (expected !== undefined && previous !== expected) return;
  window.localStorage.removeItem(SESSION_KEY);
  if (previous) void retireOfflineSession(previous);
  window.dispatchEvent(new Event(SESSION_CHANGE));
}

export function subscribeSession(listener: () => void): () => void {
  function onStorage(event: StorageEvent): void {
    if (event.key === SESSION_KEY || event.key === null) listener();
  }

  window.addEventListener("storage", onStorage);
  window.addEventListener(SESSION_CHANGE, listener);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(SESSION_CHANGE, listener);
  };
}
