"use client";

import Link from "next/link";
import type { ReactElement } from "react";
import { useTranslation } from "@/lib/i18n";

interface PendingOutcomesBarProps {
  count: number;
}

export function PendingOutcomesBar({ count }: PendingOutcomesBarProps): ReactElement | null {
  const t = useTranslation();

  // spec:impl pending-outcomes#show-need-outcome-bar-n-equal-number
  if (count <= 0) return null;

  // spec:impl pending-outcomes#open-screen-3-5-bar-tapped
  // spec:impl pending-outcomes#offer-control-dismiss-bar-separate
  return (
    <Link className="schedule-pending-bar" href="/app/meetings/pending">
      {t("meetings.need_outcome_bar", { N: count })}
      <span aria-hidden="true">›</span>
    </Link>
  );
}
