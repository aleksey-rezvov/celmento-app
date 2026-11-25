"use client";

import { useEffect, useState, type FormEvent, type ReactElement } from "react";
import { useRouter } from "next/navigation";
import { DocumentOverlay } from "@/components/DocumentOverlay";
import { ConsentCheckbox, specialistDocuments } from "@/components/auth/ConsentCheckbox";
import { ProfileError, ProfileScreen, profilePath } from "@/components/profile/ProfileScreen";
import { useAccount } from "@/lib/account";
import { apiClient, errorCode, type Schemas } from "@/lib/api/client";
import { useLanguage, useTranslation, type MessageKey } from "@/lib/i18n";
import { activationKinds, documentAcceptances, useLegalDocuments } from "@/lib/legal-documents";
import { getSessionToken } from "@/lib/session";

export default function ActivatePage(): ReactElement | null {
  const { account, refresh } = useAccount();
  const t = useTranslation();
  const language = useLanguage();
  const router = useRouter();
  const {
    documents,
    failed,
    refresh: retryDocuments,
  } = useLegalDocuments(activationKinds, account.contour, language);
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [document, setDocument] = useState<Schemas["LegalDocumentKind"] | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  const valid =
    ageConfirmed && termsAccepted && documentAcceptances(documents, activationKinds) !== null;

  useEffect(() => {
    if (account.activated) router.replace(profilePath);
  }, [account.activated, router]);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!valid || saving) return;

    const acceptances = documentAcceptances(documents, activationKinds, new Date().toISOString());
    if (!acceptances) return;
    setSaving(true);
    setError(null);

    try {
      const { data, error: failure } = await apiClient(getSessionToken()).POST(
        "/account/activation",
        {
          body: { age_confirmed: true, acceptances },
        },
      );

      if (data) {
        await refresh(data);
        return;
      }

      const code = errorCode(failure);
      if (code === "already_activated") {
        await refresh();
        return;
      }
      if (code === "consent_required") {
        setTermsAccepted(false);
        retryDocuments();
      }
      setError("extra.auth_request_failed");
    } catch {
      setError("extra.auth_network_error");
    } finally {
      setSaving(false);
    }
  }

  if (account.activated) return null;

  return (
    <ProfileScreen title="start.lead" back>
      <form className="profile-card profile-activation" onSubmit={submit}>
        {/* spec:impl client-leading-activation#open-profile-lead-button-confirmation */}
        {/* spec:impl client-leading-activation#combine-18-confirmation-document */}
        <ConsentCheckbox
          labelKey="finish.age"
          checked={ageConfirmed}
          onChange={setAgeConfirmed}
          disabled={saving}
        />
        <ConsentCheckbox
          labelKey="finish.specialist_terms"
          documents={specialistDocuments}
          checked={termsAccepted}
          onChange={setTermsAccepted}
          onDocument={setDocument}
          disabled={saving}
        />
        <ProfileError message={error ?? (failed ? "extra.auth_request_failed" : null)} />
        {failed && (
          <button className="profile-secondary" type="button" onClick={retryDocuments}>
            {t("extra.auth_retry")}
          </button>
        )}
        <button className="profile-primary" type="submit" disabled={!valid || saving}>
          {t("extra.profile_activate")}
        </button>
      </form>
      {document && (
        <DocumentOverlay
          kind={document}
          contour={account.contour}
          documents={documents}
          onClose={() => setDocument(null)}
        />
      )}
    </ProfileScreen>
  );
}
