import Link from "next/link";
import type { ReactElement, ReactNode } from "react";
import { ScreenHeader } from "@/components/shell/ScreenHeader";
import { useTranslation, type MessageKey } from "@/lib/i18n";
import "./notes-grid.css";

interface NotesScreenProps {
  title: string;
  back?: string;
  actions?: ReactNode;
  children: ReactNode;
}

export function NotesScreen({ title, back, actions, children }: NotesScreenProps): ReactElement {
  const t = useTranslation();

  return (
    <main className="notes-screen">
      <ScreenHeader
        title={title}
        actions={actions}
        back={
          back && (
            <Link className="shell-icon-button" href={back} aria-label={t("extra.back")}>
              <span aria-hidden="true">←</span>
            </Link>
          )
        }
      />
      {children}
    </main>
  );
}

export function NotesLoadError({
  error,
  retry,
}: {
  error: MessageKey;
  retry?: () => void;
}): ReactElement {
  const t = useTranslation();

  return (
    <div className="notes-load-error">
      <p role="alert">{t(error)}</p>
      {retry && (
        <button className="shell-secondary" type="button" onClick={retry}>
          {t("extra.auth_retry")}
        </button>
      )}
    </div>
  );
}
