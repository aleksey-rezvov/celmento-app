"use client";

import type { ReactElement } from "react";
import { useTranslation } from "@/lib/i18n";
import { Sheet } from "./Sheet";

interface ConfirmSheetProps {
  title: string;
  text: string;
  confirmLabel: string;
  destructive: boolean;
  pending?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onClose: () => void;
}

export function ConfirmSheet({
  title,
  text,
  confirmLabel,
  destructive,
  pending = false,
  error,
  onConfirm,
  onClose,
}: ConfirmSheetProps): ReactElement {
  const t = useTranslation();

  return (
    <Sheet title={title} onClose={onClose} closeDisabled={pending}>
      <p className="shell-sheet-text">{text}</p>
      {error && (
        <p role="alert" className="auth-error">
          {error}
        </p>
      )}
      <div className="shell-sheet-actions">
        <button
          type="button"
          className={destructive ? "shell-destructive" : "shell-primary"}
          onClick={onConfirm}
          disabled={pending}
        >
          {confirmLabel}
        </button>
        <button type="button" className="shell-secondary" onClick={onClose} disabled={pending}>
          {t("archive.cancel")}
        </button>
      </div>
    </Sheet>
  );
}
