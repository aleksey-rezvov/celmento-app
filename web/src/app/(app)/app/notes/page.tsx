"use client";

import type { ReactElement } from "react";
import { EmptyState } from "@/components/shell/EmptyState";
import { ScreenHeader } from "@/components/shell/ScreenHeader";
import { useTranslation } from "@/lib/i18n";

export default function Notes(): ReactElement {
  const t = useTranslation();

  return (
    <main>
      <ScreenHeader title={t("notes.title")} />
      <EmptyState character="notes_empty" textKey="notes.empty" />
    </main>
  );
}
