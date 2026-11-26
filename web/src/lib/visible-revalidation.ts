const refreshIntervalMs = 5000;

export function subscribeVisibleRevalidation(refresh: () => void): () => void {
  function refreshVisible(): void {
    if (document.visibilityState !== "hidden" && navigator.onLine !== false) refresh();
  }

  const interval = window.setInterval(refreshVisible, refreshIntervalMs);
  window.addEventListener("focus", refreshVisible);
  window.addEventListener("online", refreshVisible);
  document.addEventListener("visibilitychange", refreshVisible);
  return () => {
    window.clearInterval(interval);
    window.removeEventListener("focus", refreshVisible);
    window.removeEventListener("online", refreshVisible);
    document.removeEventListener("visibilitychange", refreshVisible);
  };
}
