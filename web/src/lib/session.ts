const SESSION_KEY = "celmento_app_session";

export function getSessionToken(): string | null {
  return typeof window === "undefined" ? null : window.localStorage.getItem(SESSION_KEY);
}

export function setSessionToken(token: string): void {
  window.localStorage.setItem(SESSION_KEY, token);
}

export function clearSessionToken(): void {
  window.localStorage.removeItem(SESSION_KEY);
}
