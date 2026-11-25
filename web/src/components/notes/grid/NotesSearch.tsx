import { useEffect, useRef, type ReactElement } from "react";
import { useTranslation } from "@/lib/i18n";

interface SearchButtonProps {
  controls: string;
  open: boolean;
  onToggle: () => void;
}

export function NotesSearchButton({ controls, open, onToggle }: SearchButtonProps): ReactElement {
  const t = useTranslation();

  return (
    <button
      className="shell-icon-button"
      type="button"
      aria-label={t(open ? "extra.close" : "extra.notes_search")}
      aria-controls={open ? controls : undefined}
      aria-expanded={open}
      onClick={onToggle}
    >
      {open ? (
        <span aria-hidden="true">×</span>
      ) : (
        <svg
          viewBox="0 0 24 24"
          width="22"
          height="22"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <circle cx="10.5" cy="10.5" r="6.5" />
          <path d="M15.4 15.4 20 20" />
        </svg>
      )}
    </button>
  );
}

interface NotesSearchProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
}

export function NotesSearch({ id, value, onChange }: NotesSearchProps): ReactElement {
  const t = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);

  return (
    <input
      ref={input}
      className="notes-search"
      id={id}
      type="search"
      value={value}
      maxLength={200}
      aria-label={t("extra.notes_search")}
      placeholder={t("extra.notes_search")}
      autoComplete="off"
      onChange={(event) => onChange(event.currentTarget.value)}
    />
  );
}
