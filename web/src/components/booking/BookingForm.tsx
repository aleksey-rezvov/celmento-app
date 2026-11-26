import Link from "next/link";
import { useId, type ReactElement, type ReactNode } from "react";
import type { Schemas } from "@/lib/api/client";
import { validEmail } from "@/lib/auth";
import { formatDate, formatTime } from "@/lib/format";
import { useLanguage, useTranslation, type MessageKey } from "@/lib/i18n";
import guestEnglish from "@/lib/i18n/guest-booking.en.json";
import guestRussian from "@/lib/i18n/guest-booking.ru.json";
import type { BookingFormValues } from "./BookingSession";
import { bookingFormatLabels } from "./booking-display";
import { ZoneLabel } from "./ZoneLabel";

interface BookingFormProps {
  mode: "guest" | "app";
  startsAt: string;
  timeZone: string;
  format: Schemas["SessionFormat"];
  changeTime: string | (() => void);
  values: BookingFormValues;
  onChange: (values: BookingFormValues) => void;
  onSubmit: (values: BookingFormValues) => Promise<void>;
  consent?: ReactNode;
  legalReady?: boolean;
  submitting: boolean;
  error: MessageKey | null;
}

interface FieldProps {
  kind: "name" | "email" | "contact";
  value: string;
  onChange: (value: string) => void;
}

const bookingFields = {
  name: { label: "form.name", hint: "form.name_hint", autoComplete: "name" },
  email: { label: "form.email", hint: "form.email_hint", autoComplete: "email" },
  contact: { label: "form.contact", hint: "form.contact_hint", autoComplete: "off" },
} as const satisfies Record<
  FieldProps["kind"],
  { label: MessageKey; hint: MessageKey; autoComplete: string }
>;
const bookingCopy = { en: guestEnglish, ru: guestRussian };

function BookingField({ kind, value, onChange }: FieldProps): ReactElement {
  const t = useTranslation();
  const id = useId();
  const field = bookingFields[kind];
  const invalid = kind === "email" && value !== "" && !validEmail(value);

  return (
    <div className="auth-field-with-hint">
      <label className="auth-field">
        <span>{t(field.label)}</span>
        <input
          type={kind === "email" ? "email" : "text"}
          value={value}
          autoComplete={field.autoComplete}
          autoCapitalize={kind === "email" ? "none" : undefined}
          inputMode={kind === "email" ? "email" : undefined}
          spellCheck={kind === "email" ? false : undefined}
          required={kind !== "contact"}
          aria-invalid={invalid || undefined}
          aria-describedby={id}
          onChange={(event) => onChange(event.currentTarget.value)}
        />
      </label>
      <p id={id} className={invalid ? "auth-error" : "auth-hint"}>
        {t(invalid ? "extra.auth_email_invalid" : field.hint)}
      </p>
    </div>
  );
}

export function BookingForm({
  mode,
  startsAt,
  timeZone,
  format,
  changeTime,
  values,
  onChange,
  onSubmit,
  consent,
  legalReady,
  submitting,
  error,
}: BookingFormProps): ReactElement {
  const t = useTranslation();
  const language = useLanguage();
  const commentHint = useId();
  const guest = mode === "guest";
  // spec:impl guest-booking-flow#ask-payment-booking-require-anything
  // spec:impl client-app-booking#enable-book-no-format-choice
  const canBook =
    !submitting &&
    (format !== "both" || values.place !== null) &&
    (!guest || (values.name.trim() !== "" && validEmail(values.email) && legalReady));
  const details =
    formatDate(startsAt, timeZone, language) + " · " + formatTime(startsAt, timeZone, language);

  // spec:impl guest-booking-flow#open-form-9-2-after-guest
  return (
    <section className="booking-card">
      <header className="booking-selection">
        {guest ? (
          <h1>
            <time dateTime={startsAt}>{details}</time>
          </h1>
        ) : (
          <h2>
            <time dateTime={startsAt}>{details}</time>
          </h2>
        )}
        {submitting || typeof changeTime === "function" ? (
          <button
            className="auth-text-link"
            type="button"
            onClick={typeof changeTime === "function" ? changeTime : undefined}
            disabled={submitting}
          >
            {t("form.change_time")}
          </button>
        ) : (
          <Link className="auth-text-link" href={changeTime}>
            {t("form.change_time")}
          </Link>
        )}
        <ZoneLabel timeZone={timeZone} at={new Date(startsAt)} />
      </header>
      <form
        className="auth-form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (canBook) void onSubmit(values);
        }}
      >
        <fieldset className="booking-form-fields" disabled={submitting}>
          {/* spec:impl client-app-booking#ask-no-name-email-contact */}
          {guest && (
            <>
              {/* spec:impl guest-booking-flow#ask-name-required-field-name-hint */}
              <BookingField
                kind="name"
                value={values.name}
                onChange={(name) => onChange({ ...values, name })}
              />
              <BookingField
                kind="email"
                value={values.email}
                onChange={(email) => onChange({ ...values, email })}
              />
              {/* spec:impl guest-booking-flow#offer-contact-one-optional-free-text */}
              <BookingField
                kind="contact"
                value={values.contact}
                onChange={(contact) => onChange({ ...values, contact })}
              />
            </>
          )}
          {/* spec:impl guest-booking-flow#show-required-format-choice */}
          {format === "both" ? (
            <fieldset className="booking-format">
              <legend>{t("profile.format")}</legend>
              <div className="booking-slot-grid">
                {(["online", "in_person"] as const).map((place) => (
                  <button
                    className="booking-chip"
                    type="button"
                    key={place}
                    aria-pressed={values.place === place}
                    onClick={() => onChange({ ...values, place })}
                  >
                    {t(bookingFormatLabels[place])}
                  </button>
                ))}
              </div>
            </fieldset>
          ) : (
            <p className="booking-hint">{t(bookingFormatLabels[format])}</p>
          )}
          <div className="auth-field-with-hint">
            <label className="auth-field">
              <span>{bookingCopy[language]["form.comment"]}</span>
              <textarea
                rows={3}
                value={values.comment}
                aria-describedby={commentHint}
                onChange={(event) => onChange({ ...values, comment: event.currentTarget.value })}
              />
            </label>
            <p id={commentHint} className="auth-hint">
              {t("form.comment_hint")}
            </p>
          </div>
          {guest && consent}
        </fieldset>
        {error && (
          <p className="auth-error" role="alert">
            {t(error)}
          </p>
        )}
        {/* spec:impl guest-booking-flow#keep-book-disabled-until-required */}
        <button className="auth-primary auth-full" type="submit" disabled={!canBook}>
          {t("form.book")}
        </button>
      </form>
    </section>
  );
}
