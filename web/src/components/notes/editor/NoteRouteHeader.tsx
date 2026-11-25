"use client";

import type { ReactElement } from "react";
import { ScreenHeader } from "@/components/shell/ScreenHeader";
import { useAppNavigation } from "@/components/shell/navigation";
import { useTranslation } from "@/lib/i18n";

export function NoteRouteHeader({ title, back }: { title: string; back: string }): ReactElement {
  const navigate = useAppNavigation();
  const t = useTranslation();
  return (
    <ScreenHeader
      title={title}
      back={
        <button
          type="button"
          className="shell-icon-button"
          aria-label={t("extra.back")}
          onClick={() => navigate(back)}
        >
          <span aria-hidden="true">‹</span>
        </button>
      }
    />
  );
}
