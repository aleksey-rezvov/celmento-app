"use client";

import { useRouter } from "next/navigation";
import { useEffect, type ReactElement } from "react";
import { mainScreenPath, useAccount } from "@/lib/account";

export default function AppHome(): ReactElement {
  const router = useRouter();
  const { account } = useAccount();
  const mainPath = mainScreenPath(account);

  useEffect(() => {
    // spec:impl mobile-app-shell#open-meetings-tab-leader-people
    router.replace(mainPath);
  }, [mainPath, router]);

  return <main aria-busy="true" />;
}
