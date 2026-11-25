"use client";

import { useState, type FormEvent, type ReactElement } from "react";
import { useRouter } from "next/navigation";
import { DocumentOverlay } from "@/components/DocumentOverlay";
import { NoticeBar } from "@/components/NoticeBar";
import { PhotoPicker, saveProfilePhoto, type PendingPhoto } from "@/components/profile/PhotoPicker";
import {
  AboutSection,
  ContactsSection,
  PersonalSection,
  PriceSection,
  ProfileInput,
} from "@/components/profile/ProfileFields";
import { useProfileLeaveGuard } from "@/components/profile/ProfileLeaveGuard";
import { ProfileAddress } from "@/components/profile/ProfileLinks";
import {
  ProfileAction,
  ProfileError,
  ProfileScreen,
  ProfileSection,
} from "@/components/profile/ProfileScreen";
import { TimeZonePicker } from "@/components/profile/TimeZonePicker";
import {
  profileChanges,
  profileFields,
  validProfile,
  type ProfileFields,
} from "@/components/profile/profile-edit";
import { ConfirmSheet } from "@/components/shell/ConfirmSheet";
import { useAppNavigation } from "@/components/shell/navigation";
import { useAccount } from "@/lib/account";
import { apiClient, type Schemas } from "@/lib/api/client";
import { formatDate, zoneLabel } from "@/lib/format";
import { useLanguage, useTranslation, type MessageKey } from "@/lib/i18n";
import { clearSessionToken, getSessionToken } from "@/lib/session";

export default function ProfilePage(): ReactElement {
  const { account, refresh } = useAccount();
  const t = useTranslation();
  const language = useLanguage();
  const router = useRouter();
  const navigate = useAppNavigation();
  const [draft, setDraft] = useState<ProfileFields | null>(null);
  const [photo, setPhoto] = useState<PendingPhoto | null>();
  const [photoBusy, setPhotoBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [chooseZone, setChooseZone] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [document, setDocument] = useState<Schemas["LegalDocumentKind"] | null>(null);
  const [error, setError] = useState<MessageKey | null>(null);
  const fields = draft ?? profileFields(account);
  const update = draft ? profileChanges(account, draft) : {};
  const leader = account.activated ? account.leader : null;
  const valid = validProfile(fields);
  const timeZone = zoneLabel(account.time_zone, new Date(), language);
  const dirty = Object.keys(update).length > 0 || photo !== undefined;

  function discard(): void {
    setDraft(null);
    setPhoto(undefined);
    setError(null);
  }

  async function save(): Promise<boolean> {
    if (!draft || !valid || saving || photoBusy || settingsBusy) return false;

    setSaving(true);
    setError(null);
    try {
      const client = apiClient(getSessionToken());
      if (Object.keys(update).length > 0) {
        const { data } = await client.PATCH("/account", { body: update });
        if (!data) {
          setError("extra.auth_request_failed");
          return false;
        }

        await refresh(data);
        setDraft(profileFields(data));
      }

      if (photo !== undefined) await refresh(await saveProfilePhoto(photo));
      discard();
      return true;
    } catch {
      setError("extra.auth_network_error");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function saveSetting(changes: Schemas["AccountUpdate"]): Promise<void> {
    if (saving || settingsBusy) return;
    setSettingsBusy(true);
    setError(null);

    try {
      const { data } = await apiClient(getSessionToken()).PATCH("/account", { body: changes });
      if (!data) {
        setError("extra.auth_request_failed");
        return;
      }

      // spec:impl interface-language#apply-language-change-screen-immediately
      await refresh(data);
      setChooseZone(false);
    } catch {
      setError("extra.auth_network_error");
    } finally {
      setSettingsBusy(false);
    }
  }

  async function signOut(): Promise<void> {
    if (signingOut) return;
    setSigningOut(true);
    setError(null);
    const token = getSessionToken();
    try {
      const { response } = await apiClient(token).POST("/auth/sign-out");
      if (response.status !== 204 && response.status !== 401) {
        setError("extra.auth_request_failed");
        return;
      }

      if (getSessionToken() === token) {
        // spec:impl account-profile#ask-confirmation-account-taps-logout
        clearSessionToken();
        router.replace("/login");
      } else {
        await refresh();
      }
    } catch {
      setError("extra.auth_network_error");
    } finally {
      setConfirmLogout(false);
      setSigningOut(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void save();
  }

  function setLeader(nextLeader: NonNullable<ProfileFields["leader"]>): void {
    setDraft({ ...fields, leader: nextLeader });
  }

  const leave = useProfileLeaveGuard({
    dirty,
    valid,
    saving: saving || photoBusy || settingsBusy,
    save,
    onDiscard: discard,
  });
  const editChange = draft && !saving ? setDraft : undefined;
  const leaderChange = draft && !saving ? setLeader : undefined;

  return (
    <ProfileScreen title="profile.title">
      <NoticeBar tab="profile" />
      {/* spec:impl account-profile#show-profile-tab-one-scrollable */}
      <form className="profile-card profile-card-with-avatar" onSubmit={submit}>
        {/* spec:impl account-profile#show-header-photo-initials-first */}
        <header className="profile-header">
          <PhotoPicker
            firstName={fields.first_name}
            lastName={fields.last_name}
            existing={account.photo_url}
            pending={photo}
            busy={photoBusy || saving}
            onBusyChange={setPhotoBusy}
            onChange={draft && !saving ? setPhoto : undefined}
          />
          <h2>
            {fields.first_name} {fields.last_name}
          </h2>
        </header>
        <PersonalSection fields={fields} onChange={editChange} />
        {/* spec:impl account-profile#show-about-link-section-schedule-price */}
        {/* spec:impl client-leading-activation#hide-non-leader-profile-sections-booking */}
        {fields.leader && <AboutSection leader={fields.leader} onChange={leaderChange} />}
        <ContactsSection fields={fields} onChange={editChange} />
        {/* spec:impl account-profile#show-account-leader-not-block */}
        <ProfileAddress key={account.address_url} account={account} href={account.address_url} />
        {leader && fields.leader && (
          <>
            {/* spec:impl account-profile#show-link-section-booking-link-link-copy */}
            <ProfileAddress
              key={leader.booking_url}
              account={account}
              href={leader.booking_url}
              booking
            />
            {/* spec:impl account-profile#open-screen-2-3-schedule */}
            {/* spec:impl working-hours-booking-rules#open-screen-2-3-schedule-section */}
            <div className="profile-group">
              <ProfileAction onClick={() => navigate("/app/profile/schedule")}>
                {t("profile.schedule")}
              </ProfileAction>
            </div>
            <PriceSection leader={fields.leader} onChange={leaderChange} />
            <ProfileSection title="profile.plan">
              <div className="profile-field">
                <strong>
                  {leader.plan.kind === "subscription" && leader.plan.subscription_until
                    ? t("plans.active_until", {
                        [language === "ru" ? "дата" : "date"]: formatDate(
                          leader.plan.subscription_until,
                          "UTC",
                          language,
                        ),
                      })
                    : t("profile.plan_free", { N: leader.plan.active_clients })}
                </strong>
              </div>
              <ProfileAction onClick={() => navigate("/app/plans")}>
                {t("profile.plans_button")}
              </ProfileAction>
            </ProfileSection>
          </>
        )}
        {/* spec:impl client-leading-activation#show-profile-lead-button-leader */}
        {/* spec:impl account-profile#start-activation-client-leading-activation */}
        {!account.activated && (
          <button
            type="button"
            className="profile-primary"
            onClick={() => navigate("/app/profile/activate")}
          >
            {t("start.lead")}
          </button>
        )}
        {/* spec:impl account-profile#show-settings-language-setting-timezone */}
        <ProfileSection title="profile.settings">
          {/* spec:impl interface-language#show-language-setting-language-options */}
          <fieldset className="profile-field profile-fieldset" disabled={saving || settingsBusy}>
            <legend>{t("profile.language")}</legend>
            <div className="profile-chips">
              {(["ru", "en"] as const).map((choice) => (
                <button
                  type="button"
                  key={choice}
                  aria-pressed={choice === language}
                  onClick={() => choice !== language && void saveSetting({ language: choice })}
                >
                  {choice.toUpperCase()}
                </button>
              ))}
            </div>
          </fieldset>
          {/* spec:impl time-zone-handling#show-time-zone-setting-timezone */}
          <ProfileAction
            ariaLabel={t("profile.timezone") + " " + timeZone}
            onClick={() => setChooseZone(true)}
          >
            <span className="profile-row-value">
              <small>{t("profile.timezone")}</small>
              <span>{timeZone}</span>
            </span>
          </ProfileAction>
        </ProfileSection>
        {/* spec:impl account-profile#show-help-entries-terms-privacy */}
        {/* spec:impl legal-documents#list-terms-privacy-help-section */}
        <ProfileSection title="profile.help">
          <ProfileAction onClick={() => setDocument("terms_of_use")}>
            {t("profile.terms")}
          </ProfileAction>
          <ProfileAction onClick={() => setDocument("privacy_policy")}>
            {t("profile.privacy")}
          </ProfileAction>
          {/* spec:impl product-feedback#show-feedback-entry-help-section */}
          <ProfileAction onClick={() => navigate("/app/profile/feedback")}>
            {t("profile.feedback")}
          </ProfileAction>
        </ProfileSection>
        {/* spec:impl account-profile#show-account-sign-in-email-login-email */}
        {/* spec:impl account-profile#let-sign-in-email-region-changed */}
        <ProfileSection title="profile.account">
          <ProfileInput label={t("profile.login_email")} value={account.email} />
          <ProfileInput
            label={t("profile.region")}
            value={t(account.contour === "ru" ? "finish.region_ru" : "finish.region_world")}
          />
          <p className="profile-hint profile-inline-hint">
            {t(account.contour === "ru" ? "profile.region_hint_ru" : "profile.region_hint_world")}
          </p>
          <ProfileAction danger onClick={() => leave.confirm(() => setConfirmLogout(true))}>
            {t("profile.logout")}
          </ProfileAction>
        </ProfileSection>
        <ProfileError message={error} />
        {draft && (
          <>
            {/* spec:impl account-profile#prefill-first-last-name-registration */}
            <button
              type="submit"
              className="profile-primary"
              disabled={!valid || saving || photoBusy || settingsBusy}
            >
              {t("profile.save")}
            </button>
            <button
              type="button"
              className="profile-secondary"
              disabled={saving || photoBusy}
              onClick={() => leave.confirm(discard)}
            >
              {t("archive.cancel")}
            </button>
          </>
        )}
      </form>
      {/* spec:impl account-profile#switch-edit-mode-pencil-button */}
      {!draft && (
        <button
          type="button"
          className="shell-floating-action profile-edit-button"
          aria-label={t("card.edit")}
          onClick={() => setDraft(profileFields(account))}
        >
          <span aria-hidden="true">✎</span>
        </button>
      )}
      {leave.sheet}
      {document && (
        <DocumentOverlay
          kind={document}
          contour={account.contour}
          documents={[]}
          onClose={() => setDocument(null)}
        />
      )}
      {chooseZone && (
        <TimeZonePicker
          value={account.time_zone}
          busy={settingsBusy || saving}
          onSelect={(time_zone) =>
            time_zone === account.time_zone ? setChooseZone(false) : void saveSetting({ time_zone })
          }
          onClose={() => setChooseZone(false)}
        />
      )}
      {confirmLogout && (
        <ConfirmSheet
          title={t("extra.profile_logout_title")}
          text=""
          confirmLabel={t("profile.logout")}
          destructive
          onConfirm={() => void signOut()}
          onClose={() => !signingOut && setConfirmLogout(false)}
        />
      )}
    </ProfileScreen>
  );
}
