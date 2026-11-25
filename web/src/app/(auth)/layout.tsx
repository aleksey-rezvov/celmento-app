import type { ReactElement, ReactNode } from "react";
import { DeviceScreen } from "@/components/auth/DeviceScreen";

interface AuthLayoutProps {
  children: ReactNode;
}

export default function AuthLayout({ children }: AuthLayoutProps): ReactElement {
  return <DeviceScreen>{children}</DeviceScreen>;
}
