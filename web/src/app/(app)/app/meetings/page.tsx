"use client";

import type { ReactElement } from "react";
import { NoticeBar } from "@/components/NoticeBar";
import { EmptyState } from "@/components/shell/EmptyState";
import { ScreenHeader } from "@/components/shell/ScreenHeader";
import { useAccount } from "@/lib/account";
import { useTranslation } from "@/lib/i18n";

export default function Meetings(): ReactElement {
  const { account } = useAccount();
  const t = useTranslation();

  return (
    <main>
      <ScreenHeader title={t("meetings.title")} subtitle={t("meetings.today")} />
      <NoticeBar tab="meetings" />
      <EmptyState
        character={account.activated ? "meetings_today_empty" : "attendee_meetings_empty"}
        textKey={account.activated ? "meetings.today_empty" : "c.no_bookings"}
      />
    </main>
  );
}
