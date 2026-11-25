"use client";

import type { ReactElement } from "react";
import { useAppNavigation } from "@/components/shell/navigation";
import { useTranslation, type MessageKey } from "@/lib/i18n";

interface PrivateTitleProps {
  title: string;
}

function PrivacyLabel(): ReactElement {
  const t = useTranslation();
  return (
    <small className="client-privacy-label">
      <span aria-hidden="true">🔒</span> {t("client.only_you")}
    </small>
  );
}

export function PrivateTitle({ title }: PrivateTitleProps): ReactElement {
  // spec:impl client-card-view-edit#mark-reference-contacts-client-link
  return (
    <header className="client-private-title">
      <h2>{title}</h2>
      <PrivacyLabel />
    </header>
  );
}

interface AddRowProps {
  label: MessageKey;
  href: string;
}

export function AddRow({ label, href }: AddRowProps): ReactElement {
  const t = useTranslation();
  const navigate = useAppNavigation();
  // spec:impl client-card-view-edit#collapse-empty-optional-block-single
  return (
    <button type="button" className="client-add-row" onClick={() => navigate(href)}>
      <span className="client-add-icon" aria-hidden="true">
        ＋
      </span>
      <span>{t(label)}</span>
      <PrivacyLabel />
    </button>
  );
}

interface PrivateTextBlockProps {
  title: MessageKey;
  addLabel: MessageKey;
  editHref: string | null;
  fields: readonly { label: MessageKey; value: string | null }[];
}

export function PrivateTextBlock({
  title,
  addLabel,
  editHref,
  fields,
}: PrivateTextBlockProps): ReactElement {
  const t = useTranslation();
  if (editHref && !fields.some(({ value }) => value)) {
    return <AddRow label={addLabel} href={editHref} />;
  }

  return (
    <section className="client-block">
      <PrivateTitle title={t(title)} />
      {fields.map(({ label, value }) =>
        value ? (
          <div className="client-read-field" key={label}>
            {label !== title && <small>{t(label)}</small>}
            <p>{value}</p>
          </div>
        ) : null,
      )}
    </section>
  );
}
