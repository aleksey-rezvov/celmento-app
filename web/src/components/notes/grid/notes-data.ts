"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAccount } from "@/lib/account";
import { apiClient, type Schemas } from "@/lib/api/client";
import type { MessageKey } from "@/lib/i18n";
import { offlineCache, type OfflineCache } from "@/lib/offline-cache";

type NoteRequest<T> = (
  token: string,
  signal: AbortSignal,
) => Promise<{ data?: T; response: Response }>;
type Result<T> = {
  accountId: string;
  attempt: number;
  request: NoteRequest<T>;
} & ({ data: T } | { error: MessageKey });

interface NotesRequestState<T> {
  data: T | null;
  error: MessageKey | null;
  loading: boolean;
  retry: () => void;
}

interface NotesCache<T> {
  read: (cache: OfflineCache) => T | null;
  save: (cache: OfflineCache, data: T) => void;
  remove: (cache: OfflineCache) => void;
}

function useNotesRequest<T>(
  request: NoteRequest<T>,
  enabled: boolean,
  delayMs = 0,
  stored?: NotesCache<T>,
): NotesRequestState<T> {
  const { account, currentSessionToken } = useAccount();
  const accountId = account.id;
  const [result, setResult] = useState<Result<T> | null>(null);
  const [attempt, setAttempt] = useState(0);
  const current =
    enabled &&
    result?.request === request &&
    result.accountId === accountId &&
    result.attempt === attempt
      ? result
      : null;

  useEffect(() => {
    if (!enabled) return;

    const token = currentSessionToken();
    if (!token) return;
    const cache = stored ? offlineCache(currentSessionToken) : null;
    const identity = { accountId, attempt, request };
    let pending: AbortController | null = null;
    let loaded = false;

    function active(signal: AbortSignal): boolean {
      return !signal.aborted && currentSessionToken() === token;
    }

    async function recover(signal: AbortSignal): Promise<void> {
      const saved = await cache;
      if (loaded || !active(signal)) return;
      const data = saved && stored?.read(saved);
      if (data) {
        loaded = true;
        setResult({ ...identity, data });
      } else {
        setResult({
          ...identity,
          error: navigator.onLine === false ? "extra.note_offline" : "extra.auth_network_error",
        });
      }
    }

    async function load(): Promise<void> {
      if (!token || pending || currentSessionToken() !== token) return;
      const controller = new AbortController();
      pending = controller;
      const { signal } = controller;
      try {
        if (navigator.onLine === false) {
          await recover(signal);
          return;
        }
        const { data, response } = await request(token, signal);
        const saved = await cache;
        if (!active(signal)) return;

        if (data) {
          if (saved) stored?.save(saved, data);
          loaded = true;
          setResult({ ...identity, data });
        } else if (!loaded || [401, 403, 404, 422].includes(response.status)) {
          if (saved && [401, 403, 404, 422].includes(response.status)) stored?.remove(saved);
          loaded = false;
          setResult({
            ...identity,
            error: response.status === 404 ? "extra.notes_no_results" : "extra.auth_request_failed",
          });
        }
      } catch {
        if (active(signal)) await recover(signal);
      } finally {
        pending = null;
      }
    }

    function revalidate(): void {
      if (document.visibilityState !== "hidden" && navigator.onLine !== false) void load();
    }

    const timer = delayMs > 0 ? window.setTimeout(() => void load(), delayMs) : null;
    if (timer === null) void load();
    const interval = window.setInterval(revalidate, 5000);
    window.addEventListener("focus", revalidate);
    window.addEventListener("online", revalidate);
    document.addEventListener("visibilitychange", revalidate);
    return () => {
      if (timer !== null) window.clearTimeout(timer);
      window.clearInterval(interval);
      window.removeEventListener("focus", revalidate);
      window.removeEventListener("online", revalidate);
      document.removeEventListener("visibilitychange", revalidate);
      pending?.abort();
    };
  }, [accountId, attempt, currentSessionToken, delayMs, enabled, request, stored]);

  return {
    data: current && "data" in current ? current.data : null,
    error: current && "error" in current ? current.error : null,
    loading: enabled && current === null,
    retry: () => setAttempt((value) => value + 1),
  };
}

const loadFolders: NoteRequest<Schemas["FolderList"]> = async (token, signal) => {
  // spec:impl notes-grid-folders#order-folder-tiles-creation-date
  // spec:impl notes-grid-folders#keep-folders-personal-account-created
  return apiClient(token).GET("/folders", { signal, cache: "no-store" });
};

const cachedFolders: NotesCache<Schemas["FolderList"]> = {
  read: (cache) => cache.folders(),
  save: (cache, data) => cache.saveFolders(data),
  remove: (cache) => cache.removeFolders(),
};

export function useFolders(enabled = true): NotesRequestState<Schemas["FolderList"]> {
  return useNotesRequest(loadFolders, enabled, 0, cachedFolders);
}

interface NoteListScope {
  filter?: Schemas["NoteFilter"];
  folderId?: string;
  clientId?: string;
  query?: string;
  enabled?: boolean;
}

export function useNotesList({
  filter,
  folderId,
  clientId,
  query,
  enabled = true,
}: NoteListScope): NotesRequestState<Schemas["NoteList"]> {
  const cacheKey = query ? null : JSON.stringify([filter ?? "all", folderId, clientId]);
  const stored = useMemo<NotesCache<Schemas["NoteList"]> | undefined>(
    () =>
      cacheKey === null
        ? undefined
        : {
            read: (cache) => cache.noteList(cacheKey),
            save: (cache, data) => cache.saveNoteList(cacheKey, data),
            remove: (cache) => cache.removeNoteList(cacheKey),
          },
    [cacheKey],
  );
  const request = useCallback<NoteRequest<Schemas["NoteList"]>>(
    async (token, signal) => {
      // spec:impl notes-grid-folders#sort-grid-modified-date-newest
      // spec:impl notes-grid-folders#show-root-grid-account-notes
      // spec:impl notes-grid-folders#open-search-field-magnifier-notes
      return apiClient(token).GET("/notes", {
        params: {
          query: {
            filter: query ? undefined : filter,
            folder_id: folderId,
            client_id: clientId,
            q: query,
          },
        },
        signal,
        cache: "no-store",
      });
    },
    [clientId, filter, folderId, query],
  );
  return useNotesRequest(request, enabled, query ? 160 : 0, stored);
}

export function useClientNotes(clientId: string): NotesRequestState<Schemas["ClientNoteList"]> {
  const request = useCallback<NoteRequest<Schemas["ClientNoteList"]>>(
    async (token, signal) => {
      // spec:impl client-card-view-edit#show-notes-block-3-latest
      return apiClient(token).GET("/clients/{client_id}/notes", {
        params: { path: { client_id: clientId }, query: { limit: 3 } },
        signal,
        cache: "no-store",
      });
    },
    [clientId],
  );
  return useNotesRequest(request, true);
}
