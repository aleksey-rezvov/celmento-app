import type { Schemas } from "./api/client";

export function deviceLanguage(): Schemas["Language"] {
  const language = typeof navigator === "undefined" ? undefined : navigator.language;
  return language?.split("-")[0]?.toLowerCase() === "ru" ? "ru" : "en";
}

export function deviceTimeZone(): string {
  return new Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
}
