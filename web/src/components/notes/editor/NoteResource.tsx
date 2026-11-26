"use client";

import { useEffect, useState, type ReactElement } from "react";
import { useRouter } from "next/navigation";
import { OfflineHint } from "@/components/OfflineHint";
import { useAppNavigation } from "@/components/shell/navigation";
import { useAccount } from "@/lib/account";
import { apiClient, type Schemas } from "@/lib/api/client";
import { useTranslation } from "@/lib/i18n";
import { notesPath } from "@/lib/notes-navigation";
import { offlineCache } from "@/lib/offline-cache";
import "./note-editor.css";

type Note = Schemas["Note"];

interface NoteResourceProps {
  id: string;
  allowOffline?: boolean;
  children: (note: Note, state: { cached: boolean; readOnly: boolean }) => ReactElement;
}

interface NoteResult {
  key: string;
  note: Note | null;
  cached: boolean;
  readOnly: boolean;
}

export function NoteResource({
  id,
  children,
  allowOffline = false,
}: NoteResourceProps): ReactElement {
  const { account, currentSessionToken } = useAccount();
  const router = useRouter();
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<NoteResult | null>(null);
  const key = [account.id, id, retry].join(":");
  const current = result?.key === key ? result : null;

  useEffect(() => {
    const token = currentSessionToken();
    if (!token) return;
    const cache = offlineCache(currentSessionToken);
    let disposed = false;
    let pending: AbortController | null = null;
    let loaded: Note | null = null;
    let needsVerification = false;

    function active(controller: AbortController): boolean {
      return !disposed && !controller.signal.aborted && currentSessionToken() === token;
    }

    async function recover(controller: AbortController): Promise<void> {
      needsVerification = true;
      const saved = await cache;
      if (!active(controller)) return;
      const current = loaded ?? (allowOffline ? saved?.note(id) : null) ?? null;
      // spec:impl note-editor#open-notes-read-only-no-connection-hint
      setResult({
        key,
        note: current,
        cached: loaded === null && current !== null,
        readOnly: true,
      });
    }

    async function load(): Promise<void> {
      if (pending || currentSessionToken() !== token) return;
      const controller = new AbortController();
      pending = controller;
      try {
        if (navigator.onLine === false) {
          await recover(controller);
          return;
        }
        const { data, response } = await apiClient(token).GET("/notes/{note_id}", {
          params: { path: { note_id: id } },
          cache: "no-store",
          signal: controller.signal,
        });
        const saved = await cache;
        if (!active(controller)) return;
        needsVerification = false;
        if ([401, 403, 404].includes(response.status)) {
          const previous = loaded ?? saved?.note(id);
          loaded = null;
          saved?.removeNote(id);
          setResult({ key, note: null, cached: false, readOnly: false });
          if (response.status === 404 && previous?.can_edit === false) {
            router.replace(notesPath + "?access_removed=1");
          }
        } else if (data) {
          loaded = data;
          saved?.saveNote(data);
          setResult({ key, note: data, cached: false, readOnly: false });
        } else {
          setResult({ key, note: null, cached: false, readOnly: false });
        }
      } catch {
        if (active(controller)) await recover(controller);
      } finally {
        if (pending === controller) pending = null;
      }
    }

    function disconnected(): void {
      pending?.abort();
      pending = null;
      needsVerification = true;
      setResult((previous) => (previous?.key === key ? { ...previous, readOnly: true } : previous));
      void load();
    }

    function focus(): void {
      if (needsVerification) void load();
    }

    function reconnect(): void {
      if (!needsVerification) return;
      pending?.abort();
      pending = null;
      void load();
    }

    void load();
    window.addEventListener("offline", disconnected);
    window.addEventListener("online", reconnect);
    window.addEventListener("focus", focus);
    return () => {
      disposed = true;
      pending?.abort();
      window.removeEventListener("offline", disconnected);
      window.removeEventListener("online", reconnect);
      window.removeEventListener("focus", focus);
    };
  }, [allowOffline, currentSessionToken, id, key, router]);

  if (!current) return <main className="note-route" aria-busy="true" />;
  if (!current.note)
    return <NoteUnavailable offline={current.readOnly} retry={() => setRetry(retry + 1)} />;
  return children(current.note, current);
}

interface NoteUnavailableProps {
  offline?: boolean;
  retry?: () => void;
  back?: string;
}

export function NoteUnavailable({
  offline,
  retry,
  back = notesPath,
}: NoteUnavailableProps): ReactElement {
  const t = useTranslation();
  const navigate = useAppNavigation();
  return (
    <main className="note-route note-route-error">
      {offline ? (
        <OfflineHint message="extra.note_offline" />
      ) : (
        <p role="alert">{t("extra.auth_request_failed")}</p>
      )}
      {retry && (
        <button className="shell-primary" type="button" onClick={retry}>
          {t("extra.auth_retry")}
        </button>
      )}
      <button className="shell-secondary" type="button" onClick={() => navigate(back)}>
        {t("extra.back")}
      </button>
    </main>
  );
}
