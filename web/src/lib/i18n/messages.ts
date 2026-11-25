import type { Schemas } from "../api/client";
import en from "./en.json";
import ru from "./ru.json";

export type Language = Schemas["Language"];
export type MessageKey = keyof typeof ru;
export type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

const catalogs: Record<Language, Record<MessageKey, string>> = { en, ru };

export function t(
  key: MessageKey,
  params?: Record<string, string | number>,
  language: Language = "en",
): string {
  return catalogs[language][key].replace(/\{([^{}]+)\}/gu, (placeholder, name: string) => {
    if (params && Object.hasOwn(params, name)) {
      return String(params[name]);
    }

    return placeholder;
  });
}
