"use client";

import { Fragment, useId, type ReactElement, type ReactNode } from "react";
import type { Schemas } from "@/lib/api/client";
import { useTranslation, type MessageKey } from "@/lib/i18n";

type Kind = Schemas["LegalDocumentKind"];

export const termsDocuments = [{ kind: "terms_of_use", textKey: "profile.terms" }] as const;

export const personalDataDocuments = [
  { kind: "personal_data_consent", textKey: "extra.auth_consent_link" },
] as const;

export const specialistDocuments = [
  { kind: "specialist_offer", textKey: "extra.auth_specialist_terms_link" },
  { kind: "data_processing_instruction", textKey: "extra.auth_processing_instruction_link" },
] as const;

interface DocumentLink {
  kind: Kind;
  textKey: MessageKey;
}

interface ConsentCheckboxProps {
  labelKey: MessageKey;
  params?: Record<string, string>;
  documents?: readonly DocumentLink[];
  checked: boolean;
  onChange: (checked: boolean) => void;
  onDocument?: (kind: Kind) => void;
  disabled?: boolean;
}

export function ConsentCheckbox({
  labelKey,
  params,
  documents,
  checked,
  onChange,
  onDocument,
  disabled,
}: ConsentCheckboxProps): ReactElement {
  const t = useTranslation();
  const id = useId();
  const labelID = id + "-label";
  const label = t(labelKey, params);
  const parts: ReactNode[] = [];
  let offset = 0;

  for (const document of documents ?? []) {
    const text = t(document.textKey);
    const index = label.toLocaleLowerCase().indexOf(text.toLocaleLowerCase(), offset);
    if (index === -1) {
      continue;
    }

    parts.push(
      <Fragment key={document.kind}>
        <label htmlFor={id}>{label.slice(offset, index)}</label>
        <button
          className="auth-text-link"
          type="button"
          onClick={() => onDocument?.(document.kind)}
        >
          {label.slice(index, index + text.length)}
        </button>
      </Fragment>,
    );
    offset = index + text.length;
  }

  return (
    <div className="auth-checkbox">
      <input
        id={id}
        type="checkbox"
        aria-labelledby={labelID}
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
      <span id={labelID}>
        {parts}
        <label htmlFor={id}>{label.slice(offset)}</label>
      </span>
    </div>
  );
}
