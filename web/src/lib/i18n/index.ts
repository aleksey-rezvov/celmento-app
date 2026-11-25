"use client";

import { createContext, createElement, useContext, type ReactElement, type ReactNode } from "react";
import { t, type Language, type Translate } from "./messages";

export { t, type MessageKey } from "./messages";

const LanguageContext = createContext<Language>("en");

export function useLanguage(): Language {
  return useContext(LanguageContext);
}

export function useTranslation(): Translate {
  const language = useLanguage();
  return (key, params) => t(key, params, language);
}

interface LanguageProviderProps {
  language: Language;
  children: ReactNode;
}

export function LanguageProvider({ language, children }: LanguageProviderProps): ReactElement {
  return createElement(LanguageContext.Provider, { value: language }, children);
}
