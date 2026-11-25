"use client";

import { useState, type ReactElement } from "react";
import { useAppNavigation } from "@/components/shell/navigation";
import type { Schemas } from "@/lib/api/client";
import { contourDomain } from "@/lib/contour";
import { useLanguage, useTranslation, type MessageKey } from "@/lib/i18n";
import { copyText, shareLink } from "@/lib/share";
import { ProfileError, ProfileSection } from "./ProfileScreen";

interface ProfileAddressProps {
  account: Schemas["Account"];
  booking?: boolean;
  href: string;
}

export function ProfileAddress({ account, booking, href }: ProfileAddressProps): ReactElement {
  const t = useTranslation();
  const language = useLanguage();
  const navigate = useAppNavigation();
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  const title = booking ? "profile.link_section" : "profile.client_login";

  async function copy(): Promise<void> {
    setError(null);
    try {
      // spec:impl booking-link-login#copy-address-domain-login-clipboard
      await copyText(href);
      setCopied(true);
    } catch {
      setError("extra.auth_request_failed");
    }
  }

  async function share(): Promise<void> {
    setError(null);
    try {
      const text = t("profile.link_share_text", { [language === "ru" ? "ссылка" : "link"]: href });
      // spec:impl booking-link-login#open-system-share-sheet-link-share
      await shareLink(text, href);
      if (!navigator.share) setCopied(true);
    } catch (failure) {
      if (!(failure instanceof DOMException && failure.name === "AbortError")) {
        setError("extra.auth_request_failed");
      }
    }
  }

  return (
    <ProfileSection title={title}>
      <div className="profile-field">
        <button
          type="button"
          className="profile-address"
          onClick={() => navigate("/app/profile/login")}
        >
          <span>
            <span className="profile-domain">{contourDomain(account.contour)}/</span>
            <strong>{account.login}</strong>
          </span>
          <span aria-hidden="true">›</span>
        </button>
        {!booking && <p className="profile-hint">{t("profile.client_login_hint")}</p>}
        <div className="profile-inline-actions">
          <button type="button" className="profile-secondary" onClick={copy}>
            {t("profile.link_copy")}
          </button>
          {booking && (
            <button type="button" className="profile-secondary" onClick={share}>
              {t("profile.link_share")}
            </button>
          )}
        </div>
        {copied && (
          <p className="profile-hint" role="status">
            {t("profile.link_copied")}
          </p>
        )}
        <ProfileError message={error} />
      </div>
    </ProfileSection>
  );
}
