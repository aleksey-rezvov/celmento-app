"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent, type ReactElement } from "react";
import { AuthCard } from "@/components/auth/AuthCard";
import {
  ConsentCheckbox,
  personalDataDocuments,
  specialistDocuments,
  termsDocuments,
} from "@/components/auth/ConsentCheckbox";
import { RegionField } from "@/components/auth/RegionField";
import { DocumentOverlay } from "@/components/DocumentOverlay";
import { LoginField } from "@/components/LoginField";
import { apiClient, errorCode, type Schemas } from "@/lib/api/client";
import { invalidRegistrationPackage, loginRule } from "@/lib/auth";
import { contourDomain, contourWebOrigin, type Contour } from "@/lib/contour";
import { deviceTimeZone } from "@/lib/device";
import { useLanguage, useTranslation, type MessageKey } from "@/lib/i18n";
import {
  activationKinds,
  documentAcceptances,
  finishKinds,
  noDocuments,
  signupKinds,
  useLegalDocuments,
} from "@/lib/legal-documents";
import { clearRegistration, loadPackage, saveEmail } from "@/lib/registration";
import {
  clearRegistrationDeviceKey,
  loadRegistrationDeviceKey,
  signRegistration,
} from "@/lib/registration-device";
import { getSessionToken, setSessionToken } from "@/lib/session";

type RegistrationPackage = Schemas["RegistrationPackage"];
type Kind = Schemas["LegalDocumentKind"];
type Status = Schemas["LoginAvailabilityStatus"];

interface LoginCheck {
  contour: Contour;
  input: string;
  status: Status;
}

interface FinishFormProps {
  registration: RegistrationPackage;
  deviceKey: CryptoKey;
  restart: () => void;
}

function FinishForm({ registration, deviceKey, restart }: FinishFormProps): ReactElement {
  const router = useRouter();
  const t = useTranslation();
  const language = useLanguage();
  const claims = registration.claims;

  const [contour, setContour] = useState(claims.entry_contour);
  const [login, setLogin] = useState("");
  const [verdict, setVerdict] = useState<LoginCheck | null>(null);
  const [editing, setEditing] = useState(false);
  const [failedCheck, setFailedCheck] = useState(false);
  const [checkAttempt, setCheckAttempt] = useState(0);
  const [age, setAge] = useState(false);
  const [specialistTerms, setSpecialistTerms] = useState(false);
  const [terms, setTerms] = useState(false);
  const [privacy, setPrivacy] = useState(false);
  const [notify, setNotify] = useState(true);
  const [openDocument, setOpenDocument] = useState<Kind | null>(null);
  const [error, setError] = useState<MessageKey | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const status = verdict?.contour === contour && verdict.input === login ? verdict.status : null;
  const newContour = contour !== claims.entry_contour;
  const offerActivation = claims.intent === "lead" && claims.origin === null;
  const invitingName =
    claims.origin?.page === "meeting_invite" ? claims.origin.specialist_first_name : null;
  const neededDocs = newContour
    ? offerActivation
      ? finishKinds
      : signupKinds
    : offerActivation
      ? activationKinds
      : noDocuments;
  const legal = useLegalDocuments(neededDocs, contour, language);
  // spec:impl registration-finish-screen#require-available-login
  // spec:impl registration-finish-screen#keep-button-disabled-shown-activation
  const canSubmit =
    status === "available" &&
    !submitting &&
    (!newContour || (terms && privacy)) &&
    (!offerActivation || (age && specialistTerms)) &&
    legal.documents.length === neededDocs.length;

  useEffect(() => {
    const timeout = window.setTimeout(
      restart,
      Math.max(0, Date.parse(claims.expires_at) - Date.now()),
    );
    return () => window.clearTimeout(timeout);
  }, [claims.expires_at, restart]);

  const typedLogin = editing ? login : null;
  useEffect(() => {
    if (typedLogin === "") {
      return;
    }

    const controller = new AbortController();

    async function check(): Promise<void> {
      try {
        const api = apiClient(null, contour);
        const packageRef = {
          registration_package: registration.token,
          device_proof: await signRegistration(
            deviceKey,
            typedLogin === null ? "login-proposal" : "login-availability",
            contour,
            registration.token,
          ),
        };
        if (controller.signal.aborted) {
          return;
        }

        // spec:impl registration-finish-screen#validate-login-as-typed
        const { data, error: failure } =
          typedLogin !== null
            ? await api.POST("/auth/registration/login-availability", {
                body: { ...packageRef, login: typedLogin },
                signal: controller.signal,
              })
            : await api.POST("/auth/registration/login-proposal", {
                body: packageRef,
                signal: controller.signal,
              });

        if (controller.signal.aborted) {
          return;
        }

        if (invalidRegistrationPackage(failure)) {
          restart();
        } else if (data) {
          if (typedLogin === null) {
            setLogin(data.login);
          }
          setVerdict({ contour, input: typedLogin ?? data.login, status: data.status });
          setFailedCheck(false);
        } else {
          setFailedCheck(true);
        }
      } catch {
        if (!controller.signal.aborted) {
          setFailedCheck(true);
        }
      }
    }

    if (typedLogin === null) {
      void check();
      return () => controller.abort();
    }

    const timer = window.setTimeout(() => void check(), 220);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [checkAttempt, contour, deviceKey, registration.token, restart, typedLogin]);

  function selectContour(next: Contour): void {
    setContour(next);
    setLogin("");
    setEditing(false);
    setVerdict(null);
    setFailedCheck(false);
    setTerms(false);
    setPrivacy(false);
    setSpecialistTerms(false);
    setOpenDocument(null);
    setError(null);
  }

  function editLogin(value: string): void {
    setLogin(value);
    setEditing(true);
    setVerdict(null);
    setFailedCheck(false);
    setError(null);
  }

  async function finish(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }

    const consents = newContour ? documentAcceptances(legal.documents, signupKinds) : [];
    const acceptances = offerActivation
      ? documentAcceptances(legal.documents, activationKinds)
      : [];
    if (consents === null || acceptances === null) {
      return;
    }

    setError(null);
    setSubmitting(true);
    try {
      const body: Schemas["RegistrationFinish"] = {
        registration_package: registration.token,
        device_proof: await signRegistration(deviceKey, "finish", contour, registration.token),
        login,
        language,
        time_zone: deviceTimeZone(),
        notify_specialist: invitingName ? notify : false,
      };

      if (newContour) {
        body.consents = consents;
      }
      if (offerActivation) {
        body.activation = { age_confirmed: true, acceptances };
      }

      // spec:impl region-contours#create-account-directly-selected-contour
      const { data, error: failure } = await apiClient(null, contour).POST(
        "/auth/registration/finish",
        { body },
      );

      if (data?.outcome === "session" && data.session) {
        clearRegistration();
        await clearRegistrationDeviceKey(claims.device_public_key);
        setSessionToken(data.session.token);
        router.replace("/app");
        return;
      }

      if (data?.outcome === "ticket" && data.ticket) {
        const destination = new URL(data.ticket.ticket_url);
        const expected = new URL(contourWebOrigin(contour));
        if (destination.origin === expected.origin && destination.pathname === "/login/ticket") {
          clearRegistration();
          await clearRegistrationDeviceKey(claims.device_public_key);
          // spec:impl registration-finish-screen#move-person-selected-contour-domain
          window.location.assign(destination.href);
          return;
        }
      }

      const code = errorCode(failure);
      if (invalidRegistrationPackage(failure) || code === "account_exists") {
        restart();
        return;
      }

      switch (code) {
        case "login_taken":
          // spec:impl registration-finish-screen#show-login-taken-now-keep-other-value
          setVerdict(null);
          setError("finish.login_taken_now");
          break;
        case "login_reserved":
          setVerdict({ contour, input: login, status: "reserved" });
          break;
        case "login_invalid": {
          const rule = loginRule(failure);
          setVerdict(rule ? { contour, input: login, status: rule } : null);
          setError(rule ? null : "extra.auth_request_failed");
          break;
        }
        case "consent_required":
          setTerms(false);
          setPrivacy(false);
          setSpecialistTerms(false);
          legal.refresh();
          setError("extra.auth_request_failed");
          break;
        default:
          setError("extra.auth_request_failed");
      }
    } catch {
      setError("extra.auth_network_error");
    } finally {
      setSubmitting(false);
    }
  }

  // spec:impl registration-finish-screen#show-finish-after-code
  // spec:impl registration-finish-screen#render-screen-1-4-device-language
  // spec:impl registration-finish-screen#show-celmento-master-blue-celmento-master-red
  return (
    <AuthCard title={t("finish.title")} subtitle={t("finish.subtitle")} illustration="finish_pair">
      <form className="auth-form" onSubmit={(event) => void finish(event)}>
        <RegionField
          value={contour}
          locked={claims.origin !== null}
          disabled={submitting}
          onChange={selectContour}
        />
        <LoginField
          value={login}
          onChange={editLogin}
          status={status}
          domainPrefix={contourDomain(contour) + "/"}
          labelKey="finish.login"
          hintKey="finish.login_hint"
          disabled={submitting || (!editing && login === "" && !failedCheck)}
        />
        {failedCheck && (
          <p className="auth-error" role="alert">
            {t("extra.auth_request_failed")}{" "}
            <button
              type="button"
              className="auth-text-link"
              onClick={() => setCheckAttempt((value) => value + 1)}
            >
              {t("extra.auth_retry")}
            </button>
          </p>
        )}
        {error === "finish.login_taken_now" && (
          <p className="auth-error" role="alert">
            {t(error)}
          </p>
        )}
        {/* spec:impl registration-finish-screen#show-terms-privacy-unchecked-linked */}
        {newContour && (
          <div className="auth-consents">
            <ConsentCheckbox
              labelKey="signup.terms"
              documents={termsDocuments}
              checked={terms}
              disabled={submitting}
              onChange={setTerms}
              onDocument={setOpenDocument}
            />
            <ConsentCheckbox
              labelKey="signup.privacy"
              documents={personalDataDocuments}
              checked={privacy}
              disabled={submitting}
              onChange={setPrivacy}
              onDocument={setOpenDocument}
            />
          </div>
        )}
        {/* spec:impl registration-finish-screen#show-age-specialist-terms-two-separate */}
        {/* spec:impl registration-finish-screen#show-age-checkbox-age-question */}
        {offerActivation && (
          <div className="auth-consents">
            <ConsentCheckbox
              labelKey="finish.age"
              checked={age}
              disabled={submitting}
              onChange={setAge}
            />
            <ConsentCheckbox
              labelKey="finish.specialist_terms"
              documents={specialistDocuments}
              checked={specialistTerms}
              disabled={submitting}
              onChange={setSpecialistTerms}
              onDocument={setOpenDocument}
            />
          </div>
        )}
        {invitingName && (
          <ConsentCheckbox
            labelKey="meet.notify_specialist"
            params={{ name: invitingName, имя: invitingName }}
            checked={notify}
            disabled={submitting}
            onChange={setNotify}
          />
        )}
        {legal.failed && (
          <p className="auth-error" role="alert">
            {t("extra.auth_request_failed")}{" "}
            <button type="button" className="auth-text-link" onClick={legal.refresh}>
              {t("extra.auth_retry")}
            </button>
          </p>
        )}
        {error && error !== "finish.login_taken_now" && (
          <p className="auth-error" role="alert">
            {t(error)}
          </p>
        )}
        <button type="submit" className="auth-primary auth-full" disabled={!canSubmit}>
          {t("finish.button")}
        </button>
      </form>
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

export default function FinishRegistration(): ReactElement | null {
  const router = useRouter();
  const t = useTranslation();
  const [registration] = useState(loadPackage);
  const [signedIn] = useState(() => getSessionToken() !== null);
  const [deviceKey, setDeviceKey] = useState<CryptoKey | null>(null);
  const [deviceError, setDeviceError] = useState(false);
  const [deviceAttempt, setDeviceAttempt] = useState(0);
  const redirect = signedIn ? "/app" : registration === null ? "/login" : null;

  const restart = useCallback((): void => {
    if (registration) {
      clearRegistration();
      saveEmail(registration.claims.email);
      void clearRegistrationDeviceKey(registration.claims.device_public_key);
    }

    // spec:impl registration-finish-screen#return-to-login-on-expired-package
    router.replace("/login");
  }, [registration, router]);

  useEffect(() => {
    if (redirect) {
      router.replace(redirect);
    }
  }, [redirect, router]);

  useEffect(() => {
    if (redirect || registration === null) {
      return;
    }

    let current = true;
    void loadRegistrationDeviceKey(registration.claims.device_public_key).then(
      (key) => {
        if (current) {
          if (key === null) {
            restart();
          } else {
            setDeviceKey(key);
          }
        }
      },
      () => {
        if (current) {
          setDeviceError(true);
        }
      },
    );

    return () => {
      current = false;
    };
  }, [deviceAttempt, redirect, registration, restart]);

  if (deviceError) {
    return (
      <AuthCard
        title={t("finish.title")}
        subtitle={t("finish.subtitle")}
        illustration="finish_pair"
      >
        <p className="auth-error" role="alert">
          {t("extra.auth_request_failed")}{" "}
          <button
            type="button"
            className="auth-text-link"
            onClick={() => {
              setDeviceError(false);
              setDeviceAttempt((attempt) => attempt + 1);
            }}
          >
            {t("extra.auth_retry")}
          </button>
        </p>
      </AuthCard>
    );
  }

  return redirect || registration === null || deviceKey === null ? null : (
    <FinishForm registration={registration} deviceKey={deviceKey} restart={restart} />
  );
}
