"use client";

import { useId, type ReactElement } from "react";
import { type Schemas } from "@/lib/api/client";
import { formatMoney } from "@/lib/format";
import { useLanguage, useTranslation } from "@/lib/i18n";
import {
  accountNameLimit,
  contactKeys,
  currencies,
  currencyOptions,
  filledChannels,
  specializationKeys,
  specializations,
  type ProfileFields,
} from "./profile-edit";
import { ProfileSection } from "./ProfileScreen";

interface ProfileInputProps {
  label: string;
  value: string | null;
  type?: "text" | "tel" | "email" | "url";
  autoComplete?: string;
  onChange?: (value: string) => void;
  inputMode?: "decimal";
  required?: boolean;
  maxLength?: number;
}

export function ProfileInput({
  label,
  value,
  type = "text",
  autoComplete,
  onChange,
  inputMode,
  required,
  maxLength,
}: ProfileInputProps): ReactElement {
  if (!onChange) {
    return (
      <div className="profile-field">
        <span>{label}</span>
        <strong>{value || "—"}</strong>
      </div>
    );
  }

  return (
    <label className="profile-field">
      <span>{label}</span>
      <input
        type={type}
        inputMode={inputMode}
        value={value ?? ""}
        autoComplete={autoComplete}
        required={required}
        maxLength={maxLength}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    </label>
  );
}

interface ProfileEditSectionsProps {
  fields: ProfileFields;
  onChange?: (fields: ProfileFields) => void;
}

export function PersonalSection({ fields, onChange }: ProfileEditSectionsProps): ReactElement {
  const t = useTranslation();

  return (
    <div className="profile-personal">
      <div className="profile-group">
        <ProfileInput
          label={t("signup.first_name")}
          value={fields.first_name}
          autoComplete="given-name"
          required
          maxLength={accountNameLimit}
          onChange={onChange && ((first_name) => onChange({ ...fields, first_name }))}
        />
        <ProfileInput
          label={t("signup.last_name")}
          value={fields.last_name}
          autoComplete="family-name"
          required
          maxLength={accountNameLimit}
          onChange={onChange && ((last_name) => onChange({ ...fields, last_name }))}
        />
      </div>
      {/* spec:impl account-profile#show-client-name-hint-name-field */}
      <p className="profile-hint">{t("profile.client_name_hint")}</p>
    </div>
  );
}

export function ContactsSection({ fields, onChange }: ProfileEditSectionsProps): ReactElement {
  const t = useTranslation();
  const leader = fields.leader;
  const channels = filledChannels(fields);

  function change(next: ProfileFields): void {
    if (next.leader?.main_channel && !filledChannels(next).includes(next.leader.main_channel)) {
      onChange?.({ ...next, leader: { ...next.leader, main_channel: null } });
      return;
    }

    onChange?.(next);
  }

  function changeLeader(changes: Partial<NonNullable<ProfileFields["leader"]>>): void {
    if (leader) change({ ...fields, leader: { ...leader, ...changes } });
  }

  return (
    // spec:impl account-profile#show-contacts-fields-phone-telegram
    <ProfileSection title="profile.contacts">
      <ProfileInput
        label={t("profile.phone")}
        value={fields.phone}
        type="tel"
        autoComplete="tel"
        onChange={onChange && ((phone) => change({ ...fields, phone }))}
      />
      <ProfileInput
        label={t("card.telegram")}
        value={fields.telegram}
        onChange={onChange && ((telegram) => change({ ...fields, telegram }))}
      />
      <ProfileInput
        label={t("card.whatsapp")}
        value={fields.whatsapp}
        type="tel"
        onChange={onChange && ((whatsapp) => change({ ...fields, whatsapp }))}
      />
      {leader && (
        <>
          <ProfileInput
            label={t("profile.contact_email")}
            value={leader.contact_email}
            type="email"
            autoComplete="email"
            onChange={onChange && ((contact_email) => changeLeader({ contact_email }))}
          />
          <div className="profile-field">
            <span>{t("profile.links")}</span>
            {onChange ? (
              <div className="profile-link-fields">
                {leader.links.map((link, index) => (
                  <div key={index} className="profile-link-edit">
                    <input
                      type="url"
                      autoComplete="url"
                      aria-label={t("extra.profile_link", { N: index + 1 })}
                      value={link}
                      onChange={(event) => {
                        const links = [...leader.links];
                        links[index] = event.currentTarget.value;
                        changeLeader({ links });
                      }}
                    />
                    <button
                      type="button"
                      aria-label={t("extra.profile_remove_link")}
                      onClick={() =>
                        changeLeader({ links: leader.links.filter((_, i) => index !== i) })
                      }
                    >
                      <span aria-hidden="true">×</span>
                    </button>
                  </div>
                ))}
                {leader.links.length < 5 && (
                  <button
                    type="button"
                    className="profile-text-button"
                    onClick={() => changeLeader({ links: [...leader.links, ""] })}
                  >
                    {t("extra.profile_add_link")}
                  </button>
                )}
              </div>
            ) : (
              <strong>{leader.links.join(" · ") || "—"}</strong>
            )}
          </div>
          {onChange ? (
            <label className="profile-field">
              <span>{t("profile.main_channel")}</span>
              <select
                value={leader.main_channel ?? ""}
                onChange={(event) =>
                  changeLeader({
                    main_channel:
                      channels.find((channel) => channel === event.currentTarget.value) ?? null,
                  })
                }
              >
                <option value="">—</option>
                {channels.map((channel) => (
                  <option key={channel} value={channel}>
                    {t(contactKeys[channel])}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <ProfileInput
              label={t("profile.main_channel")}
              value={leader.main_channel ? t(contactKeys[leader.main_channel]) : null}
            />
          )}
        </>
      )}
    </ProfileSection>
  );
}

interface LeaderSectionsProps {
  leader: NonNullable<ProfileFields["leader"]>;
  onChange?: (fields: NonNullable<ProfileFields["leader"]>) => void;
}

export function AboutSection({ leader, onChange }: LeaderSectionsProps): ReactElement {
  const t = useTranslation();
  const counterId = useId();
  const labelId = counterId + "-label";

  function toggle(specialization: Schemas["Specialization"]): void {
    const selection = leader.specializations.includes(specialization)
      ? leader.specializations.filter((current) => current !== specialization)
      : [...leader.specializations, specialization];

    onChange?.({
      ...leader,
      specializations: selection,
      specialization_other: selection.includes("other") ? leader.specialization_other : null,
    });
  }

  return (
    <ProfileSection title="profile.about">
      {onChange ? (
        <>
          {/* spec:impl account-profile#offer-about-field-specialization */}
          <fieldset className="profile-field profile-fieldset">
            <legend>{t("profile.specialization")}</legend>
            <div className="profile-chips">
              {specializations.map((specialization) => (
                <button
                  type="button"
                  key={specialization}
                  aria-pressed={leader.specializations.includes(specialization)}
                  onClick={() => toggle(specialization)}
                >
                  {t(specializationKeys[specialization])}
                </button>
              ))}
            </div>
          </fieldset>
          {leader.specializations.includes("other") && (
            <ProfileInput
              label={t("extra.profile_other")}
              value={leader.specialization_other}
              onChange={(specialization_other) => onChange({ ...leader, specialization_other })}
            />
          )}
          <label className="profile-field">
            <span id={labelId}>{t("profile.about_text")}</span>
            {/* spec:impl account-profile#limit-about-text-1000-characters-show */}
            <textarea
              rows={4}
              value={leader.about}
              maxLength={1000}
              aria-labelledby={labelId}
              aria-describedby={counterId}
              onChange={(event) => onChange({ ...leader, about: event.currentTarget.value })}
            />
            <small className="profile-counter" id={counterId}>
              {leader.about.length} / 1000
            </small>
          </label>
        </>
      ) : (
        <>
          <ProfileInput
            label={t("profile.specialization")}
            value={leader.specializations
              .map((specialization) =>
                specialization === "other" && leader.specialization_other
                  ? leader.specialization_other
                  : t(specializationKeys[specialization]),
              )
              .join(", ")}
          />
          <ProfileInput label={t("profile.about_text")} value={leader.about} />
        </>
      )}
    </ProfileSection>
  );
}

export function PriceSection({ leader, onChange }: LeaderSectionsProps): ReactElement {
  const t = useTranslation();
  const language = useLanguage();
  const { default_rate, default_currency } = leader;

  return (
    // spec:impl account-profile#show-price-section-price-currency
    // spec:impl default-rate-currency#show-price-section-profile-screen
    <ProfileSection title="profile.price">
      <ProfileInput
        label={t("profile.price")}
        value={
          onChange || default_rate === null
            ? default_rate
            : formatMoney({ amount: default_rate, currency: default_currency }, language)
        }
        inputMode="decimal"
        onChange={onChange && ((default_rate) => onChange({ ...leader, default_rate }))}
      />
      {onChange ? (
        <>
          <fieldset className="profile-field profile-fieldset">
            <legend>{t("profile.currency")}</legend>
            <div className="profile-chips">
              {currencyOptions.map((currency) => (
                <button
                  type="button"
                  key={currency}
                  aria-pressed={default_currency === currency}
                  onClick={() => onChange({ ...leader, default_currency: currency })}
                >
                  {currencies[currency]}
                </button>
              ))}
            </div>
          </fieldset>
          {/* spec:impl default-rate-currency#show-defaults-hint-price-fields-edit */}
          <p className="profile-hint profile-inline-hint">{t("profile.defaults_hint")}</p>
        </>
      ) : (
        <ProfileInput label={t("profile.currency")} value={currencies[default_currency]} />
      )}
    </ProfileSection>
  );
}
