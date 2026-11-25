import { useId, type ReactElement } from "react";
import { ClientAvatar } from "@/components/clients/ClientAvatar";
import { NoteAccountAvatar } from "@/components/notes/editor/NoteActions";
import { useAccount } from "@/lib/account";
import type { Schemas } from "@/lib/api/client";
import { formatDate } from "@/lib/format";
import { useTranslation } from "@/lib/i18n";
import { noteTitle } from "@/lib/note-text";

const avatarSize = 30;

function NoteAvatars({ note }: { note: Schemas["Note"] }): ReactElement | null {
  if (note.shared_with_me || !note.can_edit) {
    // spec:impl note-sharing-tags#show-shared-note-tagged-person
    return (
      <NoteAccountAvatar
        name={note.author.name}
        photoUrl={note.author.photo_url}
        size={avatarSize}
      />
    );
  }
  if (note.tags.length === 0) return null;

  return (
    <span className="notes-tile-avatars" aria-hidden="true">
      {note.tags.map((tag) => (
        <span
          key={tag.id}
          className="notes-tagged-avatar"
          data-archived={tag.archived}
          title={tag.name}
        >
          {tag.target_kind === "client_card" ? (
            <ClientAvatar
              name={tag.name}
              clientId={tag.target_id}
              photoUrl={tag.photo_url}
              size={avatarSize}
            />
          ) : (
            <NoteAccountAvatar name={tag.name} photoUrl={tag.photo_url} size={avatarSize} />
          )}
        </span>
      ))}
    </span>
  );
}

export function NoteTile({
  note,
  onOpen,
}: {
  note: Schemas["Note"];
  onOpen: () => void;
}): ReactElement {
  const t = useTranslation();
  const { account } = useAccount();
  const titleId = useId();
  const badgeId = useId();
  const title = noteTitle(note) || t("note.title_placeholder");

  // spec:impl notes-grid-folders#show-note-tile-title-beginning
  return (
    <button
      className="notes-tile"
      type="button"
      aria-labelledby={titleId}
      aria-describedby={note.shared_with_me ? badgeId : undefined}
      onClick={onOpen}
    >
      <span className="notes-tile-title" id={titleId}>
        {title}
      </span>
      {note.shared_with_me && (
        <span className="notes-shared-badge" id={badgeId}>
          {t("notes.shared_badge")}
        </span>
      )}
      <span className="notes-tile-preview">{note.text.split("\n", 8).join("\n")}</span>
      <span className="notes-tile-footer">
        <time dateTime={note.updated_at}>
          {formatDate(note.updated_at, account.time_zone, account.language, { year: "numeric" })}
        </time>
        <NoteAvatars note={note} />
      </span>
    </button>
  );
}
