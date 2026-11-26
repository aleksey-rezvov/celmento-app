"use client";

import { useRouter } from "next/navigation";
import { useEffect, type ReactElement } from "react";
import { mainScreenPath, useAccount } from "@/lib/account";
import { offlinePageTarget } from "@/lib/offline-navigation";

export default function AppHome(): ReactElement {
  const router = useRouter();
  const { account } = useAccount();
  const mainPath = mainScreenPath(account);

  useEffect(() => {
    // spec:impl mobile-app-shell#open-meetings-tab-leader-people
    const offline = offlinePageTarget(mainPath);
    if (offline) {
      window.location.replace(offline.href);
    } else {
      router.replace(mainPath);
    }
  }, [mainPath, router]);

  return <main aria-busy="true" />;
}
