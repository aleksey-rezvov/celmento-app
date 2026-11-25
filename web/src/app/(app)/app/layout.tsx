"use client";

import type { ReactElement, ReactNode } from "react";
import { BottomMenu } from "@/components/shell/BottomMenu";
import { AppNavigationProvider } from "@/components/shell/navigation";
import { AccountProvider, useAccount } from "@/lib/account";
import "./shell.css";

interface AppLayoutProps {
  children: ReactNode;
}

function AppShell({ children }: AppLayoutProps): ReactElement {
  const { account } = useAccount();

  return (
    <div className="shell" data-activated={account.activated}>
      <div className="shell-content">{children}</div>
      <BottomMenu activated={account.activated} />
    </div>
  );
}

export default function AppLayout({ children }: AppLayoutProps): ReactElement {
  return (
    <AccountProvider>
      <AppNavigationProvider>
        <AppShell>{children}</AppShell>
      </AppNavigationProvider>
    </AccountProvider>
  );
}
