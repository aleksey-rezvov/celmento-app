"use client";

import { useEffect, useRef, type ReactElement } from "react";
import { useTranslation } from "@/lib/i18n";

interface ClientSearchToggleProps {
  expanded: boolean;
  controls: string;
  onToggle: () => void;
}

export function ClientSearchToggle({
  expanded,
  controls,
  onToggle,
}: ClientSearchToggleProps): ReactElement {
  const t = useTranslation();

  return (
    <button
      className="shell-icon-button clients-search-toggle"
      type="button"
      aria-label={t(expanded ? "extra.close" : "extra.client_search")}
      aria-expanded={expanded}
      aria-controls={expanded ? controls : undefined}
      onClick={onToggle}
    >
      {expanded ? (
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

interface ClientSearchProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
}

export function ClientSearch({ id, value, onChange }: ClientSearchProps): ReactElement {
  const t = useTranslation();
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
  }, []);

  return (
    <input
      ref={input}
      id={id}
      className="clients-search-input"
      type="search"
      value={value}
      aria-label={t("extra.client_search")}
      placeholder={t("extra.client_search")}
      autoComplete="off"
      spellCheck={false}
      onChange={(event) => onChange(event.currentTarget.value)}
    />
  );
}
