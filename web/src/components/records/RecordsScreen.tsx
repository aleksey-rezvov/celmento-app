import Link from "next/link";
import type { ReactElement, ReactNode } from "react";
import { ScreenHeader } from "@/components/shell/ScreenHeader";
import { useLanguage, useTranslation, type MessageKey } from "@/lib/i18n";
import { periodLabel, usePeriod } from "@/lib/records-period";
import { recordsPath } from "./records-display";

interface RecordsScreenProps {
  title: MessageKey;
  showPeriod?: boolean;
  children: ReactNode;
}

export function RecordsScreen({
  title,
  showPeriod = true,
  children,
}: RecordsScreenProps): ReactElement {
  const t = useTranslation();
  const language = useLanguage();
  const [period] = usePeriod();

  return (
    <main className="records-page records-detail">
      <ScreenHeader
        title={t(title)}
        subtitle={showPeriod ? periodLabel(period, language, t) : undefined}
        back={
          <Link className="shell-icon-button" href={recordsPath} aria-label={t("extra.back")}>
            <span aria-hidden="true">‹</span>
          </Link>
        }
      />
      {children}
    </main>
  );
}

interface RecordsLoadStateProps {
  error: MessageKey | null;
  retry: () => void;
}

export function RecordsLoadState({ error, retry }: RecordsLoadStateProps): ReactElement {
  const t = useTranslation();

  if (!error) return <div className="records-loading" aria-busy="true" />;
  return (
    <div className="records-list-state">
      <p role="alert">{t(error)}</p>
      <button className="shell-secondary" type="button" onClick={retry}>
        {t("extra.auth_retry")}
      </button>
    </div>
  );
}

export function RecordsListEmpty(): ReactElement {
  const t = useTranslation();
  return (
    <div className="records-list-state">
      <p>{t("acc.empty_tile")}</p>
      <Link className="shell-primary" href="/app/meetings">
        {t("meetings.title")}
      </Link>
    </div>
  );
}
