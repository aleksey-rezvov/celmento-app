"use client";

import { useEffect, useRef, type ReactElement, type ReactNode } from "react";
import { useTranslation } from "@/lib/i18n";
import "./note-editor.css";

interface NoteFrameProps {
  status?: string;
  notice?: ReactNode;
  onMenu: () => void;
  onClose: () => void;
  tools?: ReactNode;
  format?: ReactNode;
  children: ReactNode;
}

export function NoteFrame({
  status,
  notice,
  onMenu,
  onClose,
  tools,
  format,
  children,
}: NoteFrameProps): ReactElement {
  const t = useTranslation();
  const frame = useRef<HTMLElement>(null);
  useEffect(() => {
    const viewport = window.visualViewport;
    const element = frame.current;
    if (!viewport || !element) return;
    const fit = (): void => {
      element.style.setProperty("--note-visual-height", viewport.height + "px");
      element.style.setProperty("--note-offset-top", viewport.offsetTop + "px");
    };
    fit();
    viewport.addEventListener("resize", fit);
    viewport.addEventListener("scroll", fit);
    return () => {
      viewport.removeEventListener("resize", fit);
      viewport.removeEventListener("scroll", fit);
    };
  }, []);

  return (
    <main className="note-editor" ref={frame} aria-label={t("notes.title")}>
      <div className="note-sheet">
        <header className="note-top">
          <p className="note-status" role="status">
            {status}
          </p>
          <button
            type="button"
            className="shell-icon-button"
            aria-label={t("extra.note_actions")}
            onClick={onMenu}
          >
            <span aria-hidden="true">…</span>
          </button>
        </header>
        {notice}
        {children}
        <footer className="note-footer">
          {tools}
          <button
            type="button"
            className="note-done"
            aria-label={t("extra.close")}
            onClick={onClose}
          >
            <span aria-hidden="true">✓</span>
          </button>
        </footer>
      </div>
      {format}
    </main>
  );
}
