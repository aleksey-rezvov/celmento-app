"use client";

import Link from "next/link";
import type { ReactElement } from "react";
import { Character } from "@/components/Character";
import type { CharacterState } from "@/lib/characters";
import { useTranslation, type MessageKey } from "@/lib/i18n";

interface EmptyStateProps {
  character: CharacterState;
  textKey: MessageKey;
  action?: { labelKey: MessageKey; href: string };
}

export function EmptyState({ character, textKey, action }: EmptyStateProps): ReactElement {
  const t = useTranslation();

  return (
    <div className="shell-empty">
      <Character state={character} size={200} />
      <p>{t(textKey)}</p>
      {action && (
        <Link className="shell-primary" href={action.href}>
          {t(action.labelKey)}
        </Link>
      )}
    </div>
  );
}
