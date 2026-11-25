"use client";

import { useEffect, useState, type FormEvent, type ReactElement } from "react";
import { useRouter } from "next/navigation";
import { LoginField } from "@/components/LoginField";
import { useProfileLeaveGuard } from "@/components/profile/ProfileLeaveGuard";
import { ProfileError, ProfileScreen, profilePath } from "@/components/profile/ProfileScreen";
import { useAccount } from "@/lib/account";
import { apiClient, errorCode, type Schemas } from "@/lib/api/client";
import { loginRule } from "@/lib/auth";
import { contourDomain } from "@/lib/contour";
import { useTranslation, type MessageKey } from "@/lib/i18n";
import { getSessionToken } from "@/lib/session";

interface Verdict {
  value: string;
  status: Schemas["LoginAvailabilityStatus"] | null;
  error: MessageKey | null;
}

export default function ProfileLoginPage(): ReactElement {
  const { account, refresh } = useAccount();
  const t = useTranslation();
  const router = useRouter();
  const [value, setValue] = useState(account.login);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [saving, setSaving] = useState(false);
  const status =
    value === account.login ? "available" : verdict?.value === value ? verdict.status : null;
  const error = verdict?.value === value ? verdict.error : null;
  const dirty = value.toLowerCase() !== account.login;
  const valid = status === "available";

  useEffect(() => {
    if (value === account.login) return;
    const abort = new AbortController();

    async function check(): Promise<void> {
      try {
        // spec:impl booking-link-login#check-availability-typed-accounts
        const { data } = await apiClient(getSessionToken()).GET("/account/login-availability", {
          params: { query: { login: value } },
          signal: abort.signal,
        });
        if (!abort.signal.aborted) {
          setVerdict({
            value,
            status: data?.status ?? null,
            error: data ? null : "extra.auth_request_failed",
          });
        }
      } catch {
        if (!abort.signal.aborted) {
          setVerdict({ value, status: null, error: "extra.auth_network_error" });
        }
      }
    }

    const timer = window.setTimeout(() => void check(), 180);
    return () => {
      window.clearTimeout(timer);
      abort.abort();
    };
  }, [value, account.login]);

  async function save(): Promise<boolean> {
    if (!valid || saving) return false;
    if (!dirty) return true;

    setSaving(true);
    try {
      const { data, error: failure } = await apiClient(getSessionToken()).PATCH("/account", {
        body: { login: value },
      });
      if (data) {
        await refresh(data);
        setValue(data.login);
        return true;
      }

      const code = errorCode(failure);
      const status =
        code === "login_taken"
          ? "taken"
          : code === "login_reserved"
            ? "reserved"
            : loginRule(failure);
      setVerdict({ value, status, error: status ? null : "extra.auth_request_failed" });
      return false;
    } catch {
      setVerdict({ value, status: null, error: "extra.auth_network_error" });
      return false;
    } finally {
      setSaving(false);
    }
  }

  const leave = useProfileLeaveGuard({ dirty, valid, saving, save });

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (await save()) router.replace(profilePath);
  }

  return (
    <ProfileScreen title="profile.client_login" back>
      <form className="profile-card" onSubmit={submit}>
        {/* spec:impl booking-link-login#check-login-typed-show-field */}
        {/* spec:impl booking-link-login#show-login-hint-login-field */}
        {/* spec:impl booking-link-login#show-login-forbidden-login-equals */}
        <LoginField
          value={value}
          onChange={(value) => {
            setValue(value);
            setVerdict(null);
          }}
          status={status}
          domainPrefix={contourDomain(account.contour) + "/"}
          labelKey="profile.client_login"
          hintKey="profile.login_hint"
          disabled={saving}
        />
        {/* spec:impl booking-link-login#show-leader-login-change-warning-before */}
        {account.activated && dirty && (
          <p className="profile-hint">{t("profile.login_change_warning")}</p>
        )}
        <ProfileError message={error} />
        {/* spec:impl booking-link-login#save-login-violates-rule-taken */}
        <button className="profile-primary" type="submit" disabled={!valid || saving}>
          {t("profile.save")}
        </button>
      </form>
      {leave.sheet}
    </ProfileScreen>
  );
}
