"use client";

import { useState, type ReactElement } from "react";
import { Character } from "@/components/Character";
import { Sheet } from "@/components/shell/Sheet";
import { useAccount } from "@/lib/account";
import type { Schemas } from "@/lib/api/client";
import { useLanguage, useTranslation } from "@/lib/i18n";
import { shareLink } from "@/lib/share";
import { shareNoteText } from "./NoteActions";

interface TagConfirmSheetProps {
  person: Schemas["NoteTaggablePerson"];
  note: Schemas["Note"];
  busy: boolean;
  disabled: boolean;
  error: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export function TagConfirmSheet({
  person,
  note,
  busy,
  disabled,
  error,
  onConfirm,
  onClose,
}: TagConfirmSheetProps): ReactElement {
  const t = useTranslation();
  const language = useLanguage();
  const { account } = useAccount();
  const [shareError, setShareError] = useState(false);
  const url = account.leader?.booking_url ?? account.address_url;
  const personName = { [language === "ru" ? "Имя" : "Name"]: person.name };

  function share(send: () => Promise<void>): void {
    setShareError(false);
    void send().catch((failure: unknown) => {
      if (!(failure instanceof DOMException && failure.name === "AbortError")) setShareError(true);
    });
  }

  // spec:impl note-sharing-tags#show-after-person-picked-leader
  // spec:impl note-sharing-tags#show-confirm-picked-person-name
  return (
    <Sheet title={t("share.button")} onClose={() => !busy && onClose()}>
      <div className="note-tag-confirm">
        {/* spec:impl note-sharing-tags#show-joy-character-tag-confirmation */}
        <div className="character-panel">
          <Character state="notes_share_confirm" size={128} />
        </div>
        <p>{t(person.tagged_before ? "share.confirm" : "share.first_warning", personName)}</p>
        {/* spec:impl note-sharing-tags#add-warning-confirmation-picked-card */}
        {!person.linked && (
          <>
            <p>{t("share.not_in_app", personName)}</p>
            <button
              type="button"
              className="shell-secondary"
              disabled={busy}
              onClick={() =>
                share(() =>
                  shareLink(
                    t("extra.client_invite_text", {
                      [language === "ru" ? "ссылка" : "link"]: url,
                    }),
                    url,
                  ),
                )
              }
            >
              {t("client.invite")}
            </button>
            <button
              type="button"
              className="shell-secondary"
              disabled={busy}
              onClick={() => share(() => shareNoteText(note))}
            >
              {t("note.send_text")}
            </button>
          </>
        )}
        {(error || shareError) && <p role="alert">{t("extra.auth_request_failed")}</p>}
        <button
          type="button"
          className="shell-primary"
          onClick={onConfirm}
          disabled={disabled || busy}
        >
          {t("share.button")}
        </button>
        <button type="button" className="shell-secondary" onClick={onClose} disabled={busy}>
          {t("share.cancel")}
        </button>
      </div>
    </Sheet>
  );
}
