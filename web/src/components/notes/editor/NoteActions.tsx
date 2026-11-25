"use client";

import Image from "next/image";
import type { ReactElement } from "react";
import { ClientAvatar } from "@/components/clients/ClientAvatar";
import { Sheet } from "@/components/shell/Sheet";
import type { Schemas } from "@/lib/api/client";
import { useTranslation } from "@/lib/i18n";
import { toShareText } from "@/lib/note-text";
import { copyText } from "@/lib/share";

type Note = Schemas["Note"];

interface NoteMenuProps {
  canTag?: boolean;
  onTag?: () => void;
  onMove?: () => void;
  onDelete?: () => void;
  onReply?: () => void;
  onShare: () => void;
  onClose: () => void;
  unavailable?: boolean;
}

export function NoteMenu({
  canTag,
  onTag,
  onMove,
  onDelete,
  onReply,
  onShare,
  onClose,
  unavailable,
}: NoteMenuProps): ReactElement {
  const t = useTranslation();
  return (
    <Sheet title={t("extra.note_actions")} onClose={onClose}>
      <div className="note-actions">
        {/* spec:impl note-editor#show-leader-note-menu-tag */}
        {canTag && onTag && (
          <button type="button" className="shell-secondary" disabled={unavailable} onClick={onTag}>
            {t("note.tag")}
          </button>
        )}
        {/* spec:impl note-editor#show-non-leader-note-menu-move */}
        {onMove && (
          <button type="button" className="shell-secondary" disabled={unavailable} onClick={onMove}>
            {t("note.move")}
          </button>
        )}
        {/* spec:impl note-editor#show-received-note-opens-read-only */}
        {onReply && (
          <button
            type="button"
            className="shell-secondary"
            disabled={unavailable}
            onClick={onReply}
          >
            {t("note.reply")}
          </button>
        )}
        <button type="button" className="shell-secondary" onClick={onShare}>
          {t("note.send_text")}
        </button>
        {onDelete && (
          <button
            type="button"
            className="shell-destructive"
            disabled={unavailable}
            onClick={onDelete}
          >
            {t("note.delete")}
          </button>
        )}
      </div>
    </Sheet>
  );
}

interface NoteAccountAvatarProps {
  name: string;
  photoUrl: string | null;
  size?: number;
}

export function NoteAccountAvatar({
  name,
  photoUrl,
  size = 32,
}: NoteAccountAvatarProps): ReactElement {
  const initials = name
    .trim()
    .split(/\s+/u, 2)
    .map((part) => Array.from(part)[0] ?? "")
    .join("")
    .toUpperCase();
  return (
    <span className="note-avatar" style={{ width: size, height: size }} aria-hidden="true">
      {photoUrl ? <Image src={photoUrl} alt="" width={size} height={size} unoptimized /> : initials}
    </span>
  );
}

interface TaggedAvatarsProps {
  tags: readonly Schemas["NoteTag"][];
  onPick?: (tag: Schemas["NoteTag"]) => void;
  disabled?: boolean;
}

export function TaggedAvatars({ tags, onPick, disabled }: TaggedAvatarsProps): ReactElement | null {
  if (!tags.length) return null;
  return (
    <ul className="note-tag-avatars">
      {tags.map((tag) => {
        const avatar =
          tag.target_kind === "client_card" ? (
            <ClientAvatar
              clientId={tag.target_id}
              name={tag.name}
              photoUrl={tag.photo_url}
              size={32}
            />
          ) : (
            <NoteAccountAvatar name={tag.name} photoUrl={tag.photo_url} />
          );
        // spec:impl client-archive-restore#keep-note-tags-archived-active
        return (
          <li key={tag.id} data-archived={tag.archived}>
            {onPick ? (
              <button
                type="button"
                aria-label={tag.name}
                disabled={disabled}
                onClick={() => onPick(tag)}
              >
                {avatar}
              </button>
            ) : (
              <span title={tag.name}>{avatar}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export async function shareNoteText(note: Pick<Note, "title" | "text">): Promise<void> {
  const text = toShareText(note);
  // spec:impl note-editor#open-system-share-sheet-send-text
  if (navigator.share) {
    await navigator.share({ text });
  } else {
    await copyText(text);
  }
}
