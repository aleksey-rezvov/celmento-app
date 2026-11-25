"use client";

import { useRouter } from "next/navigation";
import { useEffect, type ReactElement } from "react";
import { EmptyState } from "@/components/shell/EmptyState";
import { ScreenHeader } from "@/components/shell/ScreenHeader";
import { mainScreenPath, useAccount } from "@/lib/account";
import { useTranslation } from "@/lib/i18n";

export default function Records(): ReactElement | null {
  const router = useRouter();
  const { account } = useAccount();
  const t = useTranslation();
  const { activated } = account;
  const mainPath = mainScreenPath(account);

  useEffect(() => {
    if (!activated) {
      router.replace(mainPath);
    }
  }, [activated, mainPath, router]);

  if (!activated) {
    return null;
  }

  return (
    <main>
      <ScreenHeader title={t("acc.title")} />
      <EmptyState character="records_empty" textKey="acc.empty" />
    </main>
  );
}
