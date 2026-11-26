import Link from "next/link";
import type { ReactElement, ReactNode } from "react";
import { ScreenHeader } from "@/components/shell/ScreenHeader";
import { useTranslation } from "@/lib/i18n";
import "@/components/booking/booking.css";
import "./specialists.css";

interface SpecialistScreenProps {
  title: string;
  back: string;
  children: ReactNode;
}

export function SpecialistScreen({ title, back, children }: SpecialistScreenProps): ReactElement {
  const t = useTranslation();

  return (
    <main className="specialist-page">
      <ScreenHeader
        title={title}
        back={
          <Link className="shell-icon-button" href={back} aria-label={t("extra.back")}>
            <span aria-hidden="true">‹</span>
          </Link>
        }
      />
      {children}
    </main>
  );
}
