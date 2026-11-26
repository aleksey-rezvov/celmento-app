import { errorCode, type Schemas } from "./api/client";
import type { Contour } from "./contour";
import type { MessageKey } from "./i18n/messages";

export const codeCooldown = 60;
export const codeLockout = 15 * 60;

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function validEmail(value: string): boolean {
  const email = normalizeEmail(value);
  const [name, domain, additional] = email.split("@");
  return (
    email.length <= 254 &&
    additional === undefined &&
    name !== undefined &&
    name.length <= 64 &&
    /^[\p{L}\p{N}!#$%&'*+/=?^_`{|}~.-]+$/u.test(name) &&
    !name.startsWith(".") &&
    !name.endsWith(".") &&
    !name.includes("..") &&
    domain !== undefined &&
    domain.includes(".") &&
    domain
      .split(".")
      .every(
        (label) =>
          label.length <= 63 && /^[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?$/u.test(label),
      )
  );
}

export function retryAfterSeconds(error: unknown, fallback: number): number {
  if (
    typeof error === "object" &&
    error !== null &&
    "details" in error &&
    typeof error.details === "object" &&
    error.details !== null &&
    "retry_after_seconds" in error.details &&
    typeof error.details.retry_after_seconds === "number" &&
    Number.isFinite(error.details.retry_after_seconds)
  ) {
    return Math.max(0, error.details.retry_after_seconds);
  }

  return fallback;
}

export function invalidRegistrationPackage(error: unknown): boolean {
  const code = errorCode(error);
  return code === "registration_package_invalid" || code === "registration_package_expired";
}

export function reservedRegistrationContour(error: unknown): Contour | null {
  if (
    errorCode(error) === "conflict" &&
    typeof error === "object" &&
    error !== null &&
    "details" in error &&
    typeof error.details === "object" &&
    error.details !== null &&
    "selected_contour" in error.details
  ) {
    const selected = error.details.selected_contour;
    if (selected === "ru" || selected === "world") return selected;
  }
  return null;
}

const loginHintKeys = {
  available: null,
  rule_length: "profile.login_rule_length",
  rule_chars: "profile.login_rule_chars",
  rule_start: "profile.login_rule_start",
  rule_end: "profile.login_rule_end",
  rule_double: "profile.login_rule_double",
  taken: "profile.login_taken",
  reserved: "profile.login_forbidden",
} as const satisfies Record<Schemas["LoginAvailabilityStatus"], MessageKey | null>;

export function loginHint(status: Schemas["LoginAvailabilityStatus"] | null): MessageKey | null {
  return status === null ? null : loginHintKeys[status];
}

export function loginRule(error: unknown): Schemas["LoginAvailabilityStatus"] | null {
  if (
    typeof error === "object" &&
    error !== null &&
    "details" in error &&
    typeof error.details === "object" &&
    error.details !== null &&
    "rule" in error.details
  ) {
    switch (error.details.rule) {
      case "rule_length":
      case "rule_chars":
      case "rule_start":
      case "rule_end":
      case "rule_double":
        return error.details.rule;
    }
  }

  return null;
}
