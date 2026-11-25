"use client";

import { useEffect, useState, type ReactElement } from "react";
import { useAppNavigation } from "@/components/shell/navigation";
import { useAccount } from "@/lib/account";
import { apiClient, type Schemas } from "@/lib/api/client";
import { useTranslation } from "@/lib/i18n";
import { notesPath } from "@/lib/notes-navigation";
import { getSessionToken } from "@/lib/session";
import "./note-editor.css";

type Note = Schemas["Note"];

interface NoteResourceProps {
  id: string;
  children: (note: Note) => ReactElement;
}

export function NoteResource({ id, children }: NoteResourceProps): ReactElement {
  const { account } = useAccount();
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{ key: string; note: Note | null } | null>(null);
  const key = [account.id, id, retry].join(":");
  const current = result?.key === key ? result : null;

  useEffect(() => {
    const controller = new AbortController();
    const token = getSessionToken();
    async function load(): Promise<void> {
      try {
        const { data } = await apiClient(token).GET("/notes/{note_id}", {
          params: { path: { note_id: id } },
          cache: "no-store",
          signal: controller.signal,
        });
        if (!controller.signal.aborted && getSessionToken() === token) {
          setResult({ key, note: data ?? null });
        }
      } catch {
        if (!controller.signal.aborted && getSessionToken() === token)
          setResult({ key, note: null });
      }
    }
    void load();
    return () => controller.abort();
  }, [id, key]);

  if (!current) return <main className="note-route" aria-busy="true" />;
  if (!current.note) return <NoteUnavailable retry={() => setRetry(retry + 1)} />;
  return children(current.note);
}

interface NoteUnavailableProps {
  retry?: () => void;
  back?: string;
}

export function NoteUnavailable({ retry, back = notesPath }: NoteUnavailableProps): ReactElement {
  const t = useTranslation();
  const navigate = useAppNavigation();
  return (
    <main className="note-route note-route-error">
      <p role="alert">{t("extra.auth_request_failed")}</p>
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
