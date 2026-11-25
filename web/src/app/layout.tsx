import type { Metadata } from "next";
import type { ReactElement, ReactNode } from "react";
import "./globals.css";
import "./auth.css";

export const metadata: Metadata = {
  title: "celmēnto",
};

interface RootLayoutProps {
  children: ReactNode;
}

export default function RootLayout({ children }: RootLayoutProps): ReactElement {
  return (
    <html lang="en">
      <body>
        <div className="app-frame">{children}</div>
      </body>
    </html>
  );
}
