"use client";

import { useState, type FormEvent, type ReactElement } from "react";
import { Character } from "@/components/Character";
import { ChoiceChips } from "@/components/shell/ChoiceChips";
import { useAppNavigation } from "@/components/shell/navigation";
import type { Schemas } from "@/lib/api/client";
import { formatMoney, formatSessionCount } from "@/lib/format";
import { useLanguage, useTranslation, type MessageKey } from "@/lib/i18n";
import { putMeetingOutcome } from "@/lib/meeting-api";
import type { OutcomeDraft } from "@/lib/meeting-draft";
import { isArchivedClientMeeting, meetingPerson } from "@/lib/meeting-display";
import { useCurrentInstant } from "@/lib/schedule-view";
import { MeetingScreen, meetingPath } from "./MeetingScreen";
import { OutcomeFields, outcomeInput, outcomeOptions } from "./OutcomeFields";

type Detail = Schemas["MeetingDetail"];
type Status = Schemas["MeetingOutcomeStatus"];
type Input = Schemas["MeetingOutcomeInput"];

interface OutcomeFormProps {
  meeting: Detail;
  status: Status | null;
  back?: string;
}

function defaults(meeting: Detail, status: Status): OutcomeDraft {
  const duration =
    meeting.type === "mutual_practice" ? meeting.my_duration_minutes : meeting.duration_minutes;
  return {
    status,
    duration: String(
      meeting.status === "completed"
        ? (meeting.actual_duration_minutes ?? duration ?? "")
        : (duration ?? ""),
    ),
    price: meeting.price?.amount ?? "0",
    paymentType: meeting.payment_type,
    charged: null,
  };
}

export function OutcomeForm({
  meeting,
  status,
  back = meetingPath(meeting.id),
}: OutcomeFormProps): ReactElement {
  const t = useTranslation();
  const language = useLanguage();
  const now = useCurrentInstant();
  const navigate = useAppNavigation();
  const [draft, setDraft] = useState<OutcomeDraft | null>(() =>
    status ? defaults(meeting, status) : null,
  );
  const [saved, setSaved] = useState<Detail | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  const mutual = meeting.type === "mutual_practice";
  const active =
    !isArchivedClientMeeting(meeting) && Date.parse(meeting.starts_at) <= now.getTime();
  const input = draft ? outcomeInput(draft, meeting.type) : null;
  const title = t("outcome.title", {
    [language === "ru" ? "имя" : "name"]: meetingPerson(meeting, t),
  });

  async function save(body: Input): Promise<void> {
    if (!active || busy) return;
    setError(null);
    setBusy(true);
    try {
      const updated = await putMeetingOutcome(meeting.id, body);
      if (updated) setSaved(updated);
      else setError("extra.auth_request_failed");
    } catch {
      setError("extra.auth_network_error");
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (input) void save(input);
  }

  if (saved) {
    const completed = saved.status === "completed";
    const charged = completed ? saved.balance_charge : null;
    const currentBalance = saved.client_card?.balance;
    const remainder =
      charged && currentBalance?.balance.currency === charged.currency
        ? currentBalance.unpaid_sessions
        : null;
    const message = charged
      ? t("outcome.saved", {
          [language === "ru" ? "сумма" : "amount"]: formatMoney(charged, language),
        })
      : t(completed ? "outcome.saved_hours" : "extra.meeting_outcome_saved");
    return (
      <main className="meeting-screen meeting-success">
        {completed && <Character state="outcome_saved" size={160} />}
        <section className="meeting-panel">
          <h1>{message}</h1>
          {/* spec:impl meeting-outcome-recording#append-saved-debt-number-unpaid-sessions */}
          {remainder != null && (
            <p className="meeting-error">
              {t("outcome.saved_debt", { N: formatSessionCount(remainder, language) })}
            </p>
          )}
          {!completed && <p>{t("card.hours_not_counted")}</p>}
          <button type="button" className="shell-primary" onClick={() => navigate(back)}>
            {t("extra.close")}
          </button>
        </section>
      </main>
    );
  }

  if (!active) {
    return (
      <MeetingScreen title={title} back={back}>
        <p role="alert">{t("extra.auth_request_failed")}</p>
      </MeetingScreen>
    );
  }

  // spec:impl meeting-outcome-recording#ask-title-client-name-offer
  // spec:impl mutual-practice-meeting#ask-title-with-whom-text-type-mutual
  return (
    <MeetingScreen title={title} back={back}>
      {/* spec:impl character-illustrations#show-character-exactly-screens-states */}
      {draft?.status === "not_taken_place" && (
        <Character state="outcome_not_taken_place" size={160} />
      )}
      <form className="meeting-panel" onSubmit={submit}>
        <fieldset className="meeting-form-fields" disabled={busy}>
          {!draft && (
            <ChoiceChips
              label={t("form.outcome_block")}
              options={outcomeOptions.map(({ value, label }) => ({ value, label: t(label) }))}
              value={null}
              onChange={(value) => {
                if (mutual && value === "not_taken_place") void save({ status: value });
                else setDraft(defaults(meeting, value));
              }}
            />
          )}
          {draft && (
            <OutcomeFields
              draft={draft}
              type={meeting.type}
              currency={meeting.price?.currency ?? null}
              onChange={setDraft}
            />
          )}
        </fieldset>
        {error && (
          <p role="alert" className="meeting-error">
            {t(error)}
          </p>
        )}
        {draft && (
          <button type="submit" className="shell-primary" disabled={!input || busy}>
            {t("form.save")}
          </button>
        )}
      </form>
    </MeetingScreen>
  );
}
