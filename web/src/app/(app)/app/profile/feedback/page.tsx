"use client";

import { useState, type FormEvent, type ReactElement } from "react";
import { Character } from "@/components/Character";
import { ProfileError, ProfileScreen, profilePath } from "@/components/profile/ProfileScreen";
import { useAppNavigation } from "@/components/shell/navigation";
import { apiClient } from "@/lib/api/client";
import { useTranslation, type MessageKey } from "@/lib/i18n";
import { getSessionToken } from "@/lib/session";

export default function FeedbackPage(): ReactElement {
  const t = useTranslation();
  const navigate = useAppNavigation();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!text.trim() || sending) return;
    setSending(true);
    setError(null);

    try {
      const { response } = await apiClient(getSessionToken()).POST("/feedback", {
        body: { text, screen: "profile" },
      });
      if (response.status === 204) {
        setSent(true);
      } else {
        setError("extra.auth_request_failed");
      }
    } catch {
      setError("extra.auth_network_error");
    } finally {
      setSending(false);
    }
  }

  if (sent) {
    // spec:impl product-feedback#show-feedback-thanks-after-successful
    return (
      <main className="profile-screen profile-thanks">
        <Character state="feedback_thanks" size={168} />
        <div className="profile-card">
          <h1>{t("profile.feedback_thanks")}</h1>
          <button className="profile-primary" type="button" onClick={() => navigate(profilePath)}>
            {t("extra.close")}
          </button>
        </div>
      </main>
    );
  }

  return (
    <ProfileScreen title="profile.feedback" back>
      <form className="profile-card" onSubmit={submit}>
        {/* spec:impl product-feedback#open-screen-2-7-single-multi-line */}
        {/* spec:impl product-feedback#ask-anything-besides-text-account */}
        <textarea
          className="profile-feedback-input"
          aria-label={t("profile.feedback")}
          placeholder={t("profile.feedback_hint")}
          maxLength={5000}
          rows={5}
          value={text}
          disabled={sending}
          onChange={(event) => setText(event.currentTarget.value)}
        />
        <ProfileError message={error} />
        {/* spec:impl product-feedback#keep-send-button-disabled-text */}
        <button className="profile-primary" type="submit" disabled={!text.trim() || sending}>
          {t("extra.profile_feedback_send")}
        </button>
      </form>
    </ProfileScreen>
  );
}
