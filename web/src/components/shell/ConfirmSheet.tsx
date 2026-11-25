"use client";

import type { ReactElement } from "react";
import { useTranslation } from "@/lib/i18n";
import { Sheet } from "./Sheet";

interface ConfirmSheetProps {
  title: string;
  text: string;
  confirmLabel: string;
  destructive: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export function ConfirmSheet({
  title,
  text,
  confirmLabel,
  destructive,
  onConfirm,
  onClose,
}: ConfirmSheetProps): ReactElement {
  const t = useTranslation();

  return (
    <Sheet title={title} onClose={onClose}>
      <p className="shell-sheet-text">{text}</p>
      <div className="shell-sheet-actions">
        <button
          type="button"
          className={destructive ? "shell-destructive" : "shell-primary"}
          onClick={onConfirm}
        >
          {confirmLabel}
        </button>
        <button type="button" className="shell-secondary" onClick={onClose}>
          {t("archive.cancel")}
        </button>
      </div>
    </Sheet>
  );
}
