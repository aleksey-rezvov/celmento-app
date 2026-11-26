"use client";

import { useRouter } from "next/navigation";
import { useEffect, type ReactElement, type ReactNode } from "react";
import { mainScreenPath, useAccount } from "@/lib/account";

interface LeaderPlansGateProps {
  children: ReactNode;
}

export function LeaderPlansGate({ children }: LeaderPlansGateProps): ReactElement | null {
  const router = useRouter();
  const { account } = useAccount();
  const eligible = account.activated && account.leader !== null;
  const mainPath = mainScreenPath(account);

  useEffect(() => {
    if (!eligible) router.replace(mainPath);
  }, [eligible, mainPath, router]);

  return eligible ? <>{children}</> : null;
}
