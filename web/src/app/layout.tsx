import type { Metadata, Viewport } from "next";
import type { ReactElement, ReactNode } from "react";
import { OfflineShell } from "@/components/OfflineShell";
import "./globals.css";
import "./auth.css";

export const metadata: Metadata = {
  title: "celmēnto",
  manifest: "/manifest.webmanifest",
  icons: { apple: "/icon.png" },
  appleWebApp: { capable: true, title: "celmēnto" },
};

export const viewport: Viewport = {
  themeColor: "#f5ece5",
};

interface RootLayoutProps {
  children: ReactNode;
}

export default function RootLayout({ children }: RootLayoutProps): ReactElement {
  return (
    <html lang="en">
      <body>
        <div className="app-frame">{children}</div>
        <OfflineShell />
      </body>
    </html>
  );
}
