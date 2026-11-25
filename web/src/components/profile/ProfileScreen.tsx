"use client";

import type { ReactElement, ReactNode } from "react";
import { ScreenHeader } from "@/components/shell/ScreenHeader";
import { useAppNavigation } from "@/components/shell/navigation";
import { useTranslation, type MessageKey } from "@/lib/i18n";

export const profilePath = "/app/profile";

interface ProfileScreenProps {
  title: MessageKey;
  children: ReactNode;
  back?: boolean;
}

export function ProfileScreen({ title, children, back }: ProfileScreenProps): ReactElement {
  const t = useTranslation();
  const navigate = useAppNavigation();

  return (
    <main className="profile-screen">
      <ScreenHeader
        title={t(title)}
        back={
          back && (
            <button
              type="button"
              className="profile-back"
              aria-label={t("extra.back")}
              onClick={() => navigate(profilePath)}
            >
              <span aria-hidden="true">‹</span>
            </button>
          )
        }
      />
      {children}
    </main>
  );
}

interface ProfileActionProps {
  onClick: () => void;
  children: ReactNode;
  danger?: boolean;
  ariaLabel?: string;
}

export function ProfileAction({
  onClick,
  children,
  danger,
  ariaLabel,
}: ProfileActionProps): ReactElement {
  return (
    <button
      className={danger ? "profile-row profile-danger" : "profile-row"}
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
    >
      <span>{children}</span>
      <span aria-hidden="true">›</span>
    </button>
  );
}

interface ProfileSectionProps {
  title: MessageKey;
  children: ReactNode;
}

export function ProfileSection({ title, children }: ProfileSectionProps): ReactElement {
  const t = useTranslation();
  return (
    <section className="profile-section">
      <h2>{t(title)}</h2>
      <div className="profile-group">{children}</div>
    </section>
  );
}

interface ProfileErrorProps {
  message: MessageKey | null;
}

export function ProfileError({ message }: ProfileErrorProps): ReactElement | null {
  const t = useTranslation();
  return message ? (
    <p className="profile-error" role="alert">
      {t(message)}
    </p>
  ) : null;
}
