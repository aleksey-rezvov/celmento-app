"use client";

import { useEffect, useState, type FormEvent, type ReactElement } from "react";
import { useRouter } from "next/navigation";
import { ProfileInput } from "@/components/profile/ProfileFields";
import { useProfileLeaveGuard } from "@/components/profile/ProfileLeaveGuard";
import { profilePath, ProfileError, ProfileScreen } from "@/components/profile/ProfileScreen";
import { WorkingHoursEditor, workingHoursIssue } from "@/components/profile/WorkingHoursEditor";
import { optionalText, webLinkValid } from "@/components/profile/profile-edit";
import { useAccount } from "@/lib/account";
import { apiClient, type Schemas } from "@/lib/api/client";
import { zoneLabel } from "@/lib/format";
import { useLanguage, useTranslation, type MessageKey } from "@/lib/i18n";
import { getSessionToken } from "@/lib/session";

type Leader = Schemas["LeaderProfile"];
type Duration = NonNullable<Schemas["LeaderProfileUpdate"]["session_duration_minutes"]>;

const durations: readonly Duration[] = [15, 30, 45, 60, 75, 90];
const formats = [
  ["online", "profile.format_online"],
  ["in_person", "profile.format_offline"],
  ["both", "profile.format_both"],
] as const satisfies readonly (readonly [Schemas["SessionFormat"], MessageKey])[];

interface ScheduleFields {
  working_hours: Schemas["WorkingDay"][];
  session_duration_minutes: Duration;
  session_format: Schemas["SessionFormat"];
  default_meeting_link: string | null;
}

function scheduleFields(leader: Leader): ScheduleFields {
  return {
    working_hours: leader.working_hours.map((day) => ({
      ...day,
      additional_intervals: day.additional_intervals ?? [],
    })),
    session_duration_minutes:
      durations.find((duration) => leader.session_duration_minutes === duration) ?? 60,
    session_format: leader.session_format,
    default_meeting_link: leader.default_meeting_link,
  };
}

interface ScheduleEditorProps {
  leader: Leader;
}

function ScheduleEditor({ leader }: ScheduleEditorProps): ReactElement {
  const { account, refresh } = useAccount();
  const t = useTranslation();
  const language = useLanguage();
  const router = useRouter();
  const [values, setValues] = useState(() => scheduleFields(leader));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);

  const dirty = JSON.stringify(values) !== JSON.stringify(scheduleFields(leader));
  const link = optionalText(values.default_meeting_link);
  const valid =
    values.working_hours.every((day) => workingHoursIssue(day) === null) &&
    (link === null || webLinkValid(link));

  async function save(): Promise<boolean> {
    if (!valid || saving) return false;
    if (!dirty) return true;

    setSaving(true);
    setError(null);
    try {
      const { data } = await apiClient(getSessionToken()).PATCH("/account", {
        body: { leader: { ...values, default_meeting_link: link } },
      });
      if (!data?.leader) {
        setError("extra.auth_request_failed");
        return false;
      }

      await refresh(data);
      setValues(scheduleFields(data.leader));
      return true;
    } catch {
      setError("extra.auth_network_error");
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
    <ProfileScreen title="profile.schedule" back>
      <form className="profile-card" onSubmit={submit}>
        <p className="profile-hint">{zoneLabel(account.time_zone, new Date(), language)}</p>
        <fieldset className="profile-schedule-fields" disabled={saving}>
          <WorkingHoursEditor
            value={values.working_hours}
            duration={values.session_duration_minutes}
            onChange={(working_hours) => setValues({ ...values, working_hours })}
          />
          <div className="profile-group">
            <fieldset className="profile-field profile-fieldset">
              <legend>{t("profile.duration")}</legend>
              <div className="profile-chips">
                {durations.map((duration) => (
                  <button
                    type="button"
                    key={duration}
                    aria-pressed={values.session_duration_minutes === duration}
                    onClick={() => setValues({ ...values, session_duration_minutes: duration })}
                  >
                    {t("public.duration", { N: duration })}
                  </button>
                ))}
              </div>
            </fieldset>
            <fieldset className="profile-field profile-fieldset">
              <legend>{t("profile.format")}</legend>
              <div className="profile-chips">
                {formats.map(([format, key]) => (
                  <button
                    type="button"
                    key={format}
                    aria-pressed={values.session_format === format}
                    onClick={() => setValues({ ...values, session_format: format })}
                  >
                    {t(key)}
                  </button>
                ))}
              </div>
            </fieldset>
            {values.session_format !== "in_person" && (
              <ProfileInput
                label={t("profile.default_link")}
                value={values.default_meeting_link}
                type="url"
                onChange={(default_meeting_link) => setValues({ ...values, default_meeting_link })}
              />
            )}
          </div>
        </fieldset>
        <ProfileError message={error} />
        {/* spec:impl working-hours-booking-rules#block-save-show */}
        <button type="submit" className="profile-primary" disabled={!valid || saving}>
          {t("profile.save")}
        </button>
      </form>
      {leave.sheet}
    </ProfileScreen>
  );
}

export default function SchedulePage(): ReactElement | null {
  const { account } = useAccount();
  const router = useRouter();
  const leader = account.activated ? account.leader : null;

  useEffect(() => {
    if (!leader) router.replace(profilePath);
  }, [leader, router]);

  return leader ? <ScheduleEditor leader={leader} /> : null;
}
