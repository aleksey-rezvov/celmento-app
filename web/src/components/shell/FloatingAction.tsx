"use client";

import Link from "next/link";
import type { ReactElement } from "react";
import { useTranslation, type MessageKey } from "@/lib/i18n";

interface FloatingActionProps {
  href: string;
  labelKey?: MessageKey;
  disabled?: boolean;
}

export function FloatingAction({
  href,
  labelKey = "meetings.create",
  disabled = false,
}: FloatingActionProps): ReactElement {
  const t = useTranslation();
  const label = t(labelKey);

  if (disabled) {
    return (
      <button type="button" className="shell-floating-action" aria-label={label} disabled>
        <span aria-hidden="true">+</span>
      </button>
    );
  }

  return (
    <Link className="shell-floating-action" href={href} aria-label={label}>
      <span aria-hidden="true">+</span>
    </Link>
  );
}
