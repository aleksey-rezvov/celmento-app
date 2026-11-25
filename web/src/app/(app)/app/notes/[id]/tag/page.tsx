"use client";

import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState, type ReactElement } from "react";
import { ClientAvatar } from "@/components/clients/ClientAvatar";
import { NoteResource, NoteUnavailable } from "@/components/notes/editor/NoteResource";
import { NoteRouteHeader } from "@/components/notes/editor/NoteRouteHeader";
import { TagConfirmSheet } from "@/components/notes/editor/TagConfirmSheet";
import { useNoteOnline } from "@/components/notes/editor/useNoteAutosave";
import { useAccount } from "@/lib/account";
import { apiClient, errorCode, type Schemas } from "@/lib/api/client";
import { useLanguage, useTranslation } from "@/lib/i18n";
import { noteContext } from "@/lib/note-route";
import { noteHref } from "@/lib/notes-navigation";
import { getSessionToken } from "@/lib/session";

type Person = Schemas["NoteTaggablePerson"];
type Note = Schemas["Note"];

function TagPeople({ note, back }: { note: Note; back: string }): ReactElement {
  const t = useTranslation();
  const language = useLanguage();
  const router = useRouter();
  const online = useNoteOnline();
  const [people, setPeople] = useState<Person[] | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Person | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [loadError, setLoadError] = useState(false);
  const [submitError, setSubmitError] = useState(false);
  const [busy, setBusy] = useState(false);
  const posting = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    const token = getSessionToken();
    async function load(): Promise<void> {
      try {
        const { data } = await apiClient(token).GET("/notes/taggable", {
          signal: controller.signal,
          cache: "no-store",
        });
        if (controller.signal.aborted || getSessionToken() !== token) return;
        if (data) setPeople(data.items);
        else setLoadError(true);
      } catch {
        if (!controller.signal.aborted && getSessionToken() === token) setLoadError(true);
      }
    }
    void load();
    return () => controller.abort();
  }, [attempt]);

  async function confirm(person: Person): Promise<void> {
    if (posting.current || !navigator.onLine) return;
    posting.current = true;
    setBusy(true);
    setSubmitError(false);
    const token = getSessionToken();
    const path = { note_id: note.id };
    try {
      const api = apiClient(token);
      // spec:impl note-sharing-tags#tag-person-after-button-record
      // spec:impl note-sharing-tags#allow-several-people-tagged-one
      const { data, error } = await api.POST("/notes/{note_id}/tags", {
        params: { path },
        body: { target_id: person.target_id },
      });
      if (getSessionToken() !== token) return;
      if (data) {
        router.replace(back);
        return;
      }
      if (errorCode(error) === "conflict") {
        const updated = await api.GET("/notes/{note_id}", { params: { path }, cache: "no-store" });
        if (getSessionToken() !== token) return;
        if (
          updated.data?.tags.some(
            (tag) => tag.target_kind === "client_card" && tag.target_id === person.target_id,
          )
        ) {
          router.replace(back);
          return;
        }
      }
      if (errorCode(error) === "tag_not_allowed") {
        setSelected(null);
        setPeople(
          (items) => items?.filter(({ target_id }) => target_id !== person.target_id) ?? null,
        );
      }
      setSubmitError(true);
    } catch {
      if (getSessionToken() === token) setSubmitError(true);
    } finally {
      posting.current = false;
      setBusy(false);
    }
  }

  const tagged = new Set(
    note.tags
      .filter(({ target_kind }) => target_kind === "client_card")
      .map(({ target_id }) => target_id),
  );
  const matches = (people ?? []).filter(
    ({ name, target_id }) =>
      !tagged.has(target_id) &&
      name.toLocaleLowerCase(language).includes(query.trim().toLocaleLowerCase(language)),
  );
  // spec:impl note-sharing-tags#open-screen-7-3-tag-leader
  // spec:impl note-sharing-tags#list-screen-7-3-person-not-one
  return (
    <main className="note-route">
      <NoteRouteHeader title={t("note.tag")} back={back} />
      {!online && <p role="status">{t("extra.note_offline")}</p>}
      <input
        className="note-people-search"
        type="search"
        value={query}
        aria-label={t("extra.client_search")}
        placeholder={t("extra.client_search")}
        onChange={(event) => setQuery(event.currentTarget.value)}
      />
      {loadError ? (
        <div className="note-route-error">
          <p role="alert">{t("extra.auth_request_failed")}</p>
          <button
            type="button"
            className="shell-secondary"
            onClick={() => {
              setLoadError(false);
              setAttempt(attempt + 1);
            }}
          >
            {t("extra.auth_retry")}
          </button>
        </div>
      ) : !people ? (
        <div aria-busy="true" />
      ) : matches.length ? (
        <ul className="note-route-list">
          {matches.map((person) => (
            <li key={person.target_id}>
              <button
                type="button"
                disabled={!online || busy}
                onClick={() => {
                  setSelected(person);
                  setSubmitError(false);
                }}
              >
                <ClientAvatar
                  clientId={person.target_id}
                  name={person.name}
                  photoUrl={person.photo_url}
                />
                <strong>{person.name}</strong>
                <span aria-hidden="true">›</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p>{t("clients.not_found")}</p>
      )}
      {submitError && !selected && <p role="alert">{t("extra.auth_request_failed")}</p>}
      {selected && (
        <TagConfirmSheet
          key={selected.target_id}
          note={note}
          person={selected}
          busy={busy}
          disabled={!online}
          error={submitError}
          onClose={() => setSelected(null)}
          onConfirm={() => void confirm(selected)}
        />
      )}
    </main>
  );
}

function TagNoteRoute(): ReactElement {
  const { id } = useParams<{ id: string }>();
  const params = useSearchParams();
  const { account } = useAccount();
  // spec:impl note-sharing-tags#offer-tag-screen-7-3-non-leader
  if (!account.activated) return <NoteUnavailable back={noteHref(id)} />;
  return (
    <NoteResource id={id}>
      {(note) => {
        const back = noteHref(id) + noteContext(params, note.folder_id).query;
        return note.can_edit ? (
          <TagPeople key={id} note={note} back={back} />
        ) : (
          <NoteUnavailable back={back} />
        );
      }}
    </NoteResource>
  );
}

export default function TagNotePage(): ReactElement {
  return (
    <Suspense fallback={<main className="note-route" aria-busy="true" />}>
      <TagNoteRoute />
    </Suspense>
  );
}
