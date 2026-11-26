import Link from "next/link";
import type { ReactElement, ReactNode } from "react";
import { useTranslation, type MessageKey } from "@/lib/i18n";

interface SummaryTileProps {
  title: MessageKey;
  href: string;
  tone: "income" | "practice" | "expenses" | "balances" | "growth";
  value: ReactNode;
  empty: boolean;
  children?: ReactNode;
}

export function SummaryTile({
  title,
  href,
  tone,
  value,
  empty,
  children,
}: SummaryTileProps): ReactElement {
  const t = useTranslation();

  return (
    <Link className="records-tile" href={href} data-tone={tone}>
      <div className="records-tile-heading">
        <h2>{t(title)}</h2>
        <span aria-hidden="true">›</span>
      </div>
      {/* spec:impl accounting-summary#show-0-empty-tile-tile-no-data */}
      <p className="records-tile-value">{empty ? "0" : value}</p>
      {empty ? <p className="records-tile-detail">{t("acc.empty_tile")}</p> : children}
    </Link>
  );
}
