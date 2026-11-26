"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { isOfflinePage } from "@/lib/offline-navigation";

let registration: Promise<ServiceWorkerRegistration> | undefined;

export function OfflineShell(): null {
  const pathname = usePathname();

  useEffect(() => {
    if (!("serviceWorker" in navigator)) {
      return;
    }

    let current = true;
    const warmPage = async (): Promise<void> => {
      if (!navigator.onLine) {
        return;
      }
      try {
        registration ??= navigator.serviceWorker.register("/sw.js");
        await registration;
        if (!isOfflinePage(pathname)) {
          return;
        }
        const ready = await navigator.serviceWorker.ready;
        if (current) {
          ready.active?.postMessage({ type: "warm-page", pathname });
        }
      } catch {
        registration = undefined;
      }
    };

    void warmPage();
    window.addEventListener("online", warmPage);
    return () => {
      current = false;
      window.removeEventListener("online", warmPage);
    };
  }, [pathname]);

  return null;
}
