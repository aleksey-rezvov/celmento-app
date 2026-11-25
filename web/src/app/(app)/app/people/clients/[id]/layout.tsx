import type { ReactNode } from "react";
import "./client-card.css";

interface ClientCardLayoutProps {
  children: ReactNode;
}

export default function ClientCardLayout({ children }: ClientCardLayoutProps): ReactNode {
  return children;
}
