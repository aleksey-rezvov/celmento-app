"use client";

import type { ReactElement } from "react";
import { useTranslation } from "@/lib/i18n";

interface OfflineHintProps {
  message: "extra.note_offline" | "extra.meeting_offline";
  className?: string;
}

export function OfflineHint({ message, className }: OfflineHintProps): ReactElement {
  const t = useTranslation();
  return (
    <p className={className} role="status">
      {t(message)}
    </p>
  );
}
