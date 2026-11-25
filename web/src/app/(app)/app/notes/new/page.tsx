"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, type ReactElement } from "react";
import { NoteEditor } from "@/components/notes/editor/NoteEditor";
import { NoteUnavailable } from "@/components/notes/editor/NoteResource";
import { useAccount } from "@/lib/account";
import { apiClient } from "@/lib/api/client";
import { formatDate } from "@/lib/format";
import { useLanguage } from "@/lib/i18n";
import { t as translate, type Translate } from "@/lib/i18n/messages";
import { isArchivedClientMeeting, meetingPerson } from "@/lib/meeting-display";
import { createdNoteFromHistory, noteOrigin } from "@/lib/note-route";
import { noteHref, noteScopeId } from "@/lib/notes-navigation";
import { singleNoteLine } from "@/lib/note-text";
import { getSessionToken } from "@/lib/session";

function NewNote(): ReactElement {
  const params = useSearchParams();
  const router = useRouter();
  const { account } = useAccount();
  const language = useLanguage();
  const [result, setResult] = useState<{ key: string; line: string | null } | null>(null);
  const [retry, setRetry] = useState(0);
  const meetingId = noteScopeId(params.get("meeting_id"));
  const clientId = noteScopeId(params.get("client_id"));
  const folderId = noteScopeId(params.get("folder_id"));
  const hasSource = params.has("meeting_id") || params.has("client_id");
  const invalid =
    (params.has("meeting_id") && !meetingId) ||
    (params.has("client_id") && !clientId) ||
    (params.has("folder_id") && !folderId) ||
    Boolean(meetingId && clientId) ||
    Boolean(folderId && hasSource);
  const key = [account.id, meetingId, clientId, folderId, account.time_zone, language, retry].join(
    ":",
  );
  const timeZone = account.time_zone;
  const owner = account.id;
  const context = folderId
    ? "?folder_id=" + encodeURIComponent(folderId)
    : clientId
      ? "?client_id=" + encodeURIComponent(clientId)
      : "";
  const back = meetingId
    ? "/app/meetings/" + encodeURIComponent(meetingId)
    : noteOrigin(folderId, clientId);

  useEffect(() => {
    if (invalid) return;
    const savedId = createdNoteFromHistory(owner);
    if (savedId) {
      router.replace(noteHref(savedId) + context);
      return;
    }
    const controller = new AbortController();
    const token = getSessionToken();
    const options = { cache: "no-store", signal: controller.signal } as const;
    async function loadSource(): Promise<void> {
      let line: string | null = hasSource ? null : "";
      const t: Translate = (message, values) => translate(message, values, language);
      try {
        const api = apiClient(token);
        // spec:impl note-editor#start-note-opened-meeting-card
        if (meetingId) {
          const { data } = await api.GET("/meetings/{meeting_id}", {
            ...options,
            params: { path: { meeting_id: meetingId } },
          });
          if (data && !isArchivedClientMeeting(data)) {
            line = t("from_meeting.first_line", {
              [language === "ru" ? "имя" : "name"]: singleNoteLine(meetingPerson(data, t)),
              [language === "ru" ? "дата" : "date"]: formatDate(data.starts_at, timeZone, language),
            });
          }
        } else if (clientId) {
          const { data } = await api.GET("/clients/{client_id}", {
            ...options,
            params: { path: { client_id: clientId } },
          });
          if (data?.status === "active") {
            line =
              singleNoteLine(data.name) +
              ", " +
              formatDate(new Date().toISOString(), timeZone, language);
          }
        }
      } catch {
        line = null;
      }
      await Promise.resolve();
      if (!controller.signal.aborted && getSessionToken() === token) setResult({ key, line });
    }
    void loadSource();
    return () => controller.abort();
  }, [clientId, context, hasSource, invalid, key, language, meetingId, owner, router, timeZone]);

  if (invalid) return <NoteUnavailable />;
  if (result?.key !== key) return <main className="note-route" aria-busy="true" />;
  if (result.line === null)
    return <NoteUnavailable back={back} retry={() => setRetry(retry + 1)} />;
  // spec:impl meeting-card#create-new-note-write-note-first-line
  // spec:impl meeting-card#tag-client-note-created-meeting
  // spec:impl note-editor#attach-note-meeting-record-meeting
  return (
    <NoteEditor
      key={key}
      firstLine={result.line}
      folderId={folderId}
      back={back}
      context={context}
    />
  );
}

export default function NewNotePage(): ReactElement {
  return (
    <Suspense fallback={<main className="note-route" aria-busy="true" />}>
      <NewNote />
    </Suspense>
  );
}
