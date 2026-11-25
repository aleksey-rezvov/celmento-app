"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useState, type FormEvent, type ReactElement } from "react";
import { AuthCard } from "@/components/auth/AuthCard";
import {
  ConsentCheckbox,
  personalDataDocuments,
  termsDocuments,
} from "@/components/auth/ConsentCheckbox";
import { DocumentOverlay } from "@/components/DocumentOverlay";
import { apiClient, errorCode, type Schemas } from "@/lib/api/client";
import { codeCooldown, normalizeEmail, retryAfterSeconds, validEmail } from "@/lib/auth";
import { contourWebOrigin, currentContour, otherContour } from "@/lib/contour";
import { useLanguage, useTranslation, type MessageKey } from "@/lib/i18n";
import { documentAcceptances, signupKinds, useLegalDocuments } from "@/lib/legal-documents";
import {
  loadIntent,
  loadOrigin,
  loadSignupEmail,
  resumePath,
  saveCode,
  saveEmail,
  startCode,
} from "@/lib/registration";

type Kind = Schemas["LegalDocumentKind"];

interface SignupFormProps {
  initialEmail: string;
}

function SignupForm({ initialEmail }: SignupFormProps): ReactElement {
  const router = useRouter();
  const t = useTranslation();
  const language = useLanguage();
  const contour = currentContour();
  const id = useId();
  const [email, setEmail] = useState(initialEmail);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [terms, setTerms] = useState(false);
  const [privacy, setPrivacy] = useState(false);
  const [openDocument, setOpenDocument] = useState<Kind | null>(null);
  const [error, setError] = useState<MessageKey | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const legal = useLegalDocuments(signupKinds, contour, language);
  const valid = validEmail(email);
  const otherSignin = new URL("/login", contourWebOrigin(otherContour()));
  otherSignin.searchParams.set("email", normalizeEmail(email));
  // spec:impl account-registration#gate-registration-submit
  const canSubmit =
    firstName.trim() !== "" &&
    lastName.trim() !== "" &&
    terms &&
    privacy &&
    valid &&
    legal.documents.length === signupKinds.length &&
    !submitting;

  function back(): void {
    // spec:impl account-registration#return-screen-1-1-entered-email
    saveEmail(email);
    router.replace("/login");
  }

  async function register(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }

    const consents = documentAcceptances(legal.documents, signupKinds, new Date().toISOString());
    if (consents === null) {
      return;
    }

    const address = normalizeEmail(email);
    const registration: Schemas["AccountRegistration"] = {
      email: address,
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      language,
      consents,
      origin: loadOrigin(),
      intent: loadIntent(),
    };

    setSubmitting(true);
    setError(null);
    try {
      const { data, error: failure } = await apiClient(null).POST("/auth/register", {
        body: registration,
      });

      if (data) {
        // spec:impl account-registration#retain-registration-details-on-device
        startCode(address, data.first_name, data.account_exists ? undefined : registration);
        router.push("/login/code");
        return;
      }

      switch (errorCode(failure)) {
        case "email_invalid":
          setError("extra.auth_email_invalid");
          break;
        case "resend_too_soon": {
          const code = startCode(address, null, registration);
          saveCode({
            ...code,
            resendAt: Date.now() + retryAfterSeconds(failure, codeCooldown) * 1000,
          });
          router.push("/login/code");
          break;
        }
        case "code_locked":
          setError("code.locked");
          break;
        case "consent_required":
          setTerms(false);
          setPrivacy(false);
          legal.refresh();
          setError("extra.auth_request_failed");
          break;
        default:
          setError("extra.auth_request_failed");
      }
    } catch {
      // spec:impl account-registration#keep-person-screen-1-2-entered
      setError("extra.auth_network_error");
    } finally {
      setSubmitting(false);
    }
  }

  // spec:impl account-registration#show-registration-details
  // spec:impl account-registration#render-screen-1-2-device-language
  return (
    <AuthCard title={t("signup.title")} subtitle={t("signup.subtitle")} illustration="signup">
      <form className="auth-form" noValidate onSubmit={(event) => void register(event)}>
        <div className="auth-field-group">
          <label className="auth-field" htmlFor={id + "-given"}>
            <span>{t("signup.first_name")}</span>
            <input
              id={id + "-given"}
              autoComplete="given-name"
              maxLength={100}
              value={firstName}
              disabled={submitting}
              onChange={(event) => setFirstName(event.currentTarget.value)}
              required
            />
          </label>
          <label className="auth-field" htmlFor={id + "-family"}>
            <span>{t("signup.last_name")}</span>
            <input
              id={id + "-family"}
              autoComplete="family-name"
              maxLength={100}
              value={lastName}
              disabled={submitting}
              onChange={(event) => setLastName(event.currentTarget.value)}
              required
            />
          </label>
        </div>
        <label className="auth-field" htmlFor={id + "-email"}>
          <span>{t("login.email")}</span>
          <input
            id={id + "-email"}
            type="email"
            inputMode="email"
            autoCapitalize="none"
            autoComplete="email"
            spellCheck={false}
            maxLength={254}
            value={email}
            disabled={submitting}
            aria-invalid={email !== "" && !valid}
            onChange={(event) => {
              setEmail(event.currentTarget.value);
              setError(null);
            }}
          />
        </label>
        {email !== "" && !valid && (
          <p className="auth-error" role="status">
            {t("extra.auth_email_invalid")}
          </p>
        )}
        {/* spec:impl account-registration#show-two-separate-consent-checkboxes */}
        {/* spec:impl account-registration#make-document-name-inside-checkbox */}
        <div className="auth-consents">
          <ConsentCheckbox
            labelKey="signup.terms"
            checked={terms}
            disabled={submitting}
            onChange={setTerms}
            documents={termsDocuments}
            onDocument={setOpenDocument}
          />
          <ConsentCheckbox
            labelKey="signup.privacy"
            checked={privacy}
            disabled={submitting}
            onChange={setPrivacy}
            documents={personalDataDocuments}
            onDocument={setOpenDocument}
          />
        </div>
        {legal.failed && (
          <p className="auth-error" role="alert">
            {t("extra.auth_request_failed")}{" "}
            <button type="button" className="auth-text-link" onClick={legal.refresh}>
              {t("extra.auth_retry")}
            </button>
          </p>
        )}
        {error && (
          <p className="auth-error" role="alert">
            {t(error)}
          </p>
        )}
        <div className="auth-actions">
          <button
            type="button"
            className="auth-icon auth-icon-secondary"
            onClick={back}
            disabled={submitting}
            aria-label={t("code.change_email")}
          >
            <span aria-hidden="true">←</span>
          </button>
          <button type="submit" className="auth-primary" disabled={!canSubmit}>
            {t("signup.create")}
          </button>
        </div>
      </form>
      {/* spec:impl account-registration#show-other-region-link-create */}
      {/* spec:impl account-registration#open-screen-1-1-other-zone */}
      <p className="auth-other-region">
        {t("signup.other_region")}{" "}
        <a className="auth-text-link" href={otherSignin.href} rel="noreferrer">
          {t("signup.other_region_link")}
        </a>
      </p>
      {openDocument && (
        <DocumentOverlay
          kind={openDocument}
          contour={contour}
          documents={legal.documents}
          onClose={() => setOpenDocument(null)}
        />
      )}
    </AuthCard>
  );
}

export default function Signup(): ReactElement | null {
  const router = useRouter();
  const [email] = useState(loadSignupEmail);
  const [next] = useState(resumePath);
  const redirect =
    next === "/app" || next === "/register/finish" ? next : email === null ? "/login" : null;

  useEffect(() => {
    if (redirect) {
      router.replace(redirect);
    }
  }, [redirect, router]);

  // spec:impl account-registration#offer-separate-registration-entry-point
  return redirect || email === null ? null : <SignupForm initialEmail={email} />;
}
