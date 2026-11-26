const SESSION_KEY = "celmento_app_session";
const SESSION_CHANGE = "celmento-session-change";

export function getSessionToken(): string | null {
  return typeof window === "undefined" ? null : window.localStorage.getItem(SESSION_KEY);
}

export function setSessionToken(token: string): void {
  window.localStorage.setItem(SESSION_KEY, token);
  window.dispatchEvent(new Event(SESSION_CHANGE));
}

export function clearSessionToken(): void {
  window.localStorage.removeItem(SESSION_KEY);
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
