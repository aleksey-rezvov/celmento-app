import type { Schemas } from "./api/client";
import { normalizeEmail } from "./auth";
import { clearRegistrationDeviceKey } from "./registration-device";
import { getSessionToken } from "./session";

const storageKeys = {
  intent: "celmento_app_registration_intent",
  origin: "celmento_app_registration_origin",
  registrationPackage: "celmento_app_registration_package",
  email: "celmento_app_sign_in_email",
  signupEmail: "celmento_app_signup_email",
  code: "celmento_app_sign_in_code",
} as const;

type RegistrationIntent = Schemas["RegistrationIntent"];
type RegistrationOrigin = Schemas["RegistrationOrigin"];
type RegistrationPackage = Schemas["RegistrationPackage"];
type RegistrationClaims = Schemas["RegistrationPackageClaims"];

export interface PendingCode {
  email: string;
  firstName: string | null;
  origin?: RegistrationOrigin | null;
  registration?: Schemas["AccountRegistration"];
  resendAt: number;
  expiresAt: number;
  lockedUntil: number;
}

export interface SignInHandoff {
  email: string | null;
  origin: RegistrationOrigin | null;
}

let codeScreenOpen = false;

function read(key: string): string | null {
  return typeof window === "undefined" ? null : window.localStorage.getItem(key);
}

function readJson(value: string | null): unknown {
  if (value === null) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function isIntent(value: unknown): value is RegistrationIntent {
  return value === "lead" || value === "attend";
}

function isOrigin(value: unknown): value is RegistrationOrigin {
  return (
    isRecord(value) &&
    typeof value.login === "string" &&
    value.login.length > 0 &&
    (value.specialist_first_name === undefined ||
      value.specialist_first_name === null ||
      typeof value.specialist_first_name === "string") &&
    ((value.page === "public_booking" && value.meeting_id === null) ||
      (value.page === "meeting_invite" && typeof value.meeting_id === "string"))
  );
}

function isConsent(value: unknown): value is Schemas["ConsentAcceptance"] {
  return (
    isRecord(value) &&
    (value.document === "terms_of_use" ||
      value.document === "personal_data_consent" ||
      value.document === "specialist_offer" ||
      value.document === "data_processing_instruction") &&
    typeof value.version === "string" &&
    (value.accepted_at === undefined || typeof value.accepted_at === "string")
  );
}

function isClaims(value: unknown): value is RegistrationClaims {
  return (
    isRecord(value) &&
    typeof value.email === "string" &&
    typeof value.first_name === "string" &&
    typeof value.last_name === "string" &&
    (value.intent === null || isIntent(value.intent)) &&
    (value.origin === null || isOrigin(value.origin)) &&
    (value.entry_contour === "ru" || value.entry_contour === "world") &&
    value.code_confirmed === true &&
    Array.isArray(value.consents) &&
    value.consents.every(isConsent) &&
    typeof value.issued_at === "string" &&
    typeof value.expires_at === "string" &&
    typeof value.device_public_key === "string"
  );
}

function isRegistration(value: unknown): value is Schemas["AccountRegistration"] {
  return (
    isRecord(value) &&
    typeof value.email === "string" &&
    typeof value.first_name === "string" &&
    typeof value.last_name === "string" &&
    (value.language === "ru" || value.language === "en") &&
    (value.intent == null || isIntent(value.intent)) &&
    (value.origin == null || isOrigin(value.origin)) &&
    Array.isArray(value.consents) &&
    value.consents.every(isConsent)
  );
}

function isPendingCode(value: unknown): value is PendingCode {
  return (
    isRecord(value) &&
    typeof value.email === "string" &&
    (value.firstName === null || typeof value.firstName === "string") &&
    (value.origin == null || isOrigin(value.origin)) &&
    (value.registration === undefined || isRegistration(value.registration)) &&
    typeof value.resendAt === "number" &&
    typeof value.expiresAt === "number" &&
    typeof value.lockedUntil === "number"
  );
}

export function saveIntent(intent: RegistrationIntent): void {
  // spec:impl registration-intent-screen#retain-intent-on-device
  window.localStorage.setItem(storageKeys.intent, intent);
  window.localStorage.removeItem(storageKeys.origin);
}

export function loadIntent(): RegistrationIntent | null {
  const value = read(storageKeys.intent);
  return isIntent(value) ? value : null;
}

export function saveOrigin(origin: RegistrationOrigin): void {
  window.localStorage.setItem(
    storageKeys.origin,
    JSON.stringify({ page: origin.page, login: origin.login, meeting_id: origin.meeting_id }),
  );
  window.localStorage.removeItem(storageKeys.intent);
}

export function loadOrigin(): RegistrationOrigin | null {
  return parseRegistrationOrigin(read(storageKeys.origin));
}

export function parseRegistrationOrigin(value: string | null): RegistrationOrigin | null {
  const origin = readJson(value);
  return isOrigin(origin)
    ? { page: origin.page, login: origin.login, meeting_id: origin.meeting_id }
    : null;
}

function matchesHandoff(
  handoff: SignInHandoff,
  email: string,
  origin: RegistrationOrigin | null,
): boolean {
  const target = handoff.origin;
  const sameOrigin =
    target === null || origin === null
      ? target === origin
      : target.page === origin.page &&
        target.login.toLowerCase() === origin.login.toLowerCase() &&
        target.meeting_id?.toLowerCase() === origin.meeting_id?.toLowerCase();
  return (
    sameOrigin &&
    (handoff.email === null || normalizeEmail(handoff.email) === normalizeEmail(email))
  );
}

export function prepareSignInHandoff(handoff: SignInHandoff): void {
  const previousOrigin = loadOrigin();
  const pending = loadPackage();
  if (pending && !matchesHandoff(handoff, pending.claims.email, pending.claims.origin)) {
    window.localStorage.removeItem(storageKeys.registrationPackage);
    void clearRegistrationDeviceKey(pending.claims.device_public_key);
  }

  const code = loadCode();
  const codeOrigin = code?.registration
    ? (code.registration.origin ?? null)
    : (code?.origin ?? null);
  if (code && !matchesHandoff(handoff, code.email, codeOrigin)) {
    window.localStorage.removeItem(storageKeys.code);
    closeCode();
  }

  const signupEmail = loadSignupEmail();
  if (signupEmail && !matchesHandoff(handoff, signupEmail, previousOrigin)) {
    window.localStorage.removeItem(storageKeys.signupEmail);
  }

  if (handoff.origin) {
    saveOrigin(handoff.origin);
  } else {
    window.localStorage.removeItem(storageKeys.origin);
    window.localStorage.removeItem(storageKeys.intent);
  }
  if (handoff.email) saveEmail(normalizeEmail(handoff.email));
}

export function savePackage(registrationPackage: RegistrationPackage): void {
  window.localStorage.setItem(storageKeys.registrationPackage, JSON.stringify(registrationPackage));
  window.localStorage.removeItem(storageKeys.code);
  window.localStorage.removeItem(storageKeys.signupEmail);
  codeScreenOpen = false;
}

export function loadPackage(): RegistrationPackage | null {
  const value = readJson(read(storageKeys.registrationPackage));
  if (
    isRecord(value) &&
    typeof value.token === "string" &&
    isClaims(value.claims) &&
    Date.parse(value.claims.expires_at) > Date.now()
  ) {
    return { token: value.token, claims: value.claims };
  }

  if (typeof window !== "undefined") {
    window.localStorage.removeItem(storageKeys.registrationPackage);
  }

  return null;
}

export function clearRegistration(): void {
  for (const key of Object.values(storageKeys)) {
    window.localStorage.removeItem(key);
  }

  codeScreenOpen = false;
}

export function saveEmail(email: string): void {
  window.localStorage.setItem(storageKeys.email, email);
}

export function loadEmail(): string {
  return read(storageKeys.email) ?? "";
}

export function saveSignupEmail(email: string): void {
  closeCode();
  window.localStorage.removeItem(storageKeys.code);
  saveEmail(email);
  window.localStorage.setItem(storageKeys.signupEmail, email);
}

export function loadSignupEmail(): string | null {
  return read(storageKeys.signupEmail);
}

export function saveCode(code: PendingCode): void {
  window.localStorage.setItem(storageKeys.code, JSON.stringify(code));
  window.localStorage.removeItem(storageKeys.signupEmail);
  saveEmail(code.email);
}

export function loadCode(): PendingCode | null {
  const pendingCode = readJson(read(storageKeys.code));
  if (!isPendingCode(pendingCode)) {
    return null;
  }

  if (!codeScreenOpen && Math.max(pendingCode.expiresAt, pendingCode.lockedUntil) <= Date.now()) {
    window.localStorage.removeItem(storageKeys.code);
    return null;
  }

  return pendingCode;
}

export function startCode(
  email: string,
  firstName: string | null,
  registration?: PendingCode["registration"],
): PendingCode {
  const now = Date.now();
  const code: PendingCode = {
    email,
    firstName,
    origin: registration ? (registration.origin ?? null) : loadOrigin(),
    registration,
    resendAt: now + 60_000,
    expiresAt: now + 600_000,
    lockedUntil: 0,
  };

  saveCode(code);
  codeScreenOpen = true;
  return code;
}

export function resumeCode(email: string): boolean {
  const code = loadCode();
  if (
    code === null ||
    code.email !== email ||
    Math.max(code.expiresAt, code.lockedUntil) <= Date.now()
  ) {
    return false;
  }

  codeScreenOpen = true;
  return true;
}

export function loadOpenCode(): PendingCode | null {
  return codeScreenOpen ? loadCode() : null;
}

export function closeCode(): void {
  codeScreenOpen = false;
}

export function resumePath(handoff?: SignInHandoff): "/app" | "/register/finish" | "/login" | null {
  if (getSessionToken()) {
    return "/app";
  }

  const hasStoredPackage = read(storageKeys.registrationPackage) !== null;
  const registration = loadPackage();
  if (
    registration &&
    (!handoff || matchesHandoff(handoff, registration.claims.email, registration.claims.origin))
  ) {
    // spec:impl registration-finish-screen#reopen-screen-1-4-prefill-without-asking
    return "/register/finish";
  }

  if (handoff || hasStoredPackage || loadCode() || loadSignupEmail() || loadEmail()) {
    // spec:impl email-code-sign-in#reopen-screen-1-1-email-prefilled
    return "/login";
  }

  return null;
}
