import type { ReactNode } from "react";
import "./profile.css";

interface ProfileLayoutProps {
  children: ReactNode;
}

export default function ProfileLayout({ children }: ProfileLayoutProps): ReactNode {
  return children;
}
