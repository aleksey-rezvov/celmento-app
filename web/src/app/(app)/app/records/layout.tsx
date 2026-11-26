"use client";

import { useRouter } from "next/navigation";
import { useEffect, type ReactElement, type ReactNode } from "react";
import { mainScreenPath, useAccount } from "@/lib/account";
import { RecordsPeriodProvider } from "@/lib/records-period";
import "../people/clients.css";
import "./records.css";

interface RecordsLayoutProps {
  children: ReactNode;
}

export default function RecordsLayout({ children }: RecordsLayoutProps): ReactElement | null {
  const router = useRouter();
  const { account } = useAccount();
  const mainPath = mainScreenPath(account);

  useEffect(() => {
    if (!account.activated) router.replace(mainPath);
  }, [account.activated, mainPath, router]);

  if (!account.activated) return null;
  // spec:impl accounting-summary#offer-manual-entry-hours-income
  return <RecordsPeriodProvider>{children}</RecordsPeriodProvider>;
}
