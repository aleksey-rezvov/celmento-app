"use client";

import { useEffect, useId, useRef, type ReactElement, type ReactNode } from "react";
import { useTranslation } from "@/lib/i18n";

interface SheetProps {
  title: string;
  children: ReactNode;
  onClose: () => void;
}

export function Sheet({ title, children, onClose }: SheetProps): ReactElement {
  const t = useTranslation();
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const modal = dialog.current;
    modal?.showModal();
    return () => modal?.close();
  }, []);

  return (
    <dialog
      ref={dialog}
      className="shell-sheet"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="shell-sheet-content">
        <header className="shell-sheet-header">
          <h2 id={titleId}>{title}</h2>
          <button
            type="button"
            className="shell-icon-button"
            onClick={onClose}
            aria-label={t("extra.close")}
          >
            <span aria-hidden="true">×</span>
          </button>
        </header>
        {children}
      </div>
    </dialog>
  );
}
