"use client";

import { useEffect, useSyncExternalStore, type ReactElement, type ReactNode } from "react";
import { deviceLanguage } from "@/lib/device";
import { LanguageProvider } from "@/lib/i18n";
import type { Language } from "@/lib/i18n/messages";

function subscribe(): () => void {
  return () => {};
}

function deviceReady(): boolean {
  return true;
}

function serverReady(): boolean {
  return false;
}

function serverLanguage(): Language {
  return "en";
}

export function useDeviceLanguage(): Language {
  return useSyncExternalStore(subscribe, deviceLanguage, serverLanguage);
}

interface DeviceScreenProps {
  children: ReactNode;
}

export function DeviceScreen({ children }: DeviceScreenProps): ReactElement | null {
  const ready = useSyncExternalStore(subscribe, deviceReady, serverReady);
  const language = useDeviceLanguage();

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  // spec:impl interface-language#show-screens-1-0-1-4-device
  return ready ? <LanguageProvider language={language}>{children}</LanguageProvider> : null;
}
