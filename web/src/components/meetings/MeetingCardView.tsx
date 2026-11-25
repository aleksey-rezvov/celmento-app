"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactElement } from "react";
import { ContactButtons } from "@/components/ContactButtons";
import { ClientAvatar } from "@/components/clients/ClientAvatar";
import { clientPath } from "@/components/clients/card/ClientCardScreen";
import { Sheet } from "@/components/shell/Sheet";
import { useAppNavigation } from "@/components/shell/navigation";
import { useAccount } from "@/lib/account";
import type { Schemas } from "@/lib/api/client";
import { formatDate, formatMoney, formatTime, otherPartyHint } from "@/lib/format";
import { useLanguage, useTranslation, type MessageKey } from "@/lib/i18n";
import {
  isArchivedClientMeeting,
  meetingStatusLabels,
  meetingTypeLabels,
} from "@/lib/meeting-display";
import { newSourceNotePath } from "@/lib/note-route";
import { copyText } from "@/lib/share";
import { MeetingChangeSheet } from "./MeetingChangeSheet";
import { MeetingScreen, meetingPath, meetingsPath } from "./MeetingScreen";

type Detail = Schemas["MeetingDetail"];

interface MeetingCardViewProps {
  meeting: Detail;
}

function usableLink(value: string | null): string | null {
  if (!value) return null;
  try {
    return ["https:", "http:", "zoommtg:", "msteams:"].includes(new URL(value).protocol)
      ? value
      : null;
  } catch {
    return null;
  }
}

function useStarted(startsAt: string): boolean {
  const [now, setNow] = useState(Date.now);
  const starts = Date.parse(startsAt);
  useEffect(() => {
    if (now >= starts) return;
    const timer = window.setTimeout(
      () => setNow(Date.now()),
      Math.max(1, Math.min(starts - Date.now(), 2147483647)),
    );
    return () => window.clearTimeout(timer);
  }, [now, starts]);
  return now >= starts;
}

export function MeetingCardView({ meeting }: MeetingCardViewProps): ReactElement {
  const t = useTranslation();
  const language = useLanguage();
  const { account } = useAccount();
  const navigate = useAppNavigation();
  const router = useRouter();
  const [menu, setMenu] = useState(false);
  const [change, setChange] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  const scheduled = meeting.status === "scheduled";
  const missed = meeting.status === "not_taken_place";
  const mutual = meeting.type === "mutual_practice";
  const client = meeting.client_card;
  const clientRef = meeting.client;
  const archived = isArchivedClientMeeting(meeting);
  const hasContacts =
    client &&
    [client.phone, client.telegram, client.whatsapp, client.email].some((value) => value?.trim());
  const started = useStarted(meeting.starts_at);
  const addOutcome = scheduled && started && !archived;
  const timeZone = account.time_zone;
  const href = meetingPath(meeting.id);
  const place = meeting.place === "online" ? t("form.place_online") : t("form.place_offline");
  const link = usableLink(meeting.meeting_link);
  const date = formatDate(meeting.starts_at, timeZone, language);
  const time = formatTime(meeting.starts_at, timeZone, language);
  // spec:impl time-zone-handling#show-leader-attendee-local-time
  const clientTime = clientRef?.linked
    ? otherPartyHint(
        meeting.starts_at,
        timeZone,
        clientRef.time_zone,
        "client.client_time",
        language,
      )
    : null;
  // spec:impl meeting-card#show-empty-field-meeting-empty
  const field = (
    key: MessageKey,
    value: string | null,
    hint?: string | null,
  ): ReactElement | null =>
    value ? (
      <div className="meeting-field meeting-read">
        <span>{t(key)}</span>
        <p>
          <strong>{value}</strong>
          {hint && <small className="meeting-hint"> · {hint}</small>}
        </p>
      </div>
    ) : null;

  async function share(): Promise<void> {
    if (!meeting.invite_url) return;
    setError(null);
    try {
      await copyText(
        t("card.share_link_text", { [language === "ru" ? "ссылка" : "link"]: meeting.invite_url }),
      );
      setCopied(true);
    } catch {
      setError("extra.auth_request_failed");
    }
  }

  function writeNote(): void {
    navigate(newSourceNotePath("meeting_id", meeting.id));
  }

  return (
    <MeetingScreen
      title={t(meetingTypeLabels[meeting.type])}
      actions={
        <button
          type="button"
          className="shell-icon-button"
          aria-label={t("extra.meeting_actions")}
          onClick={() => setMenu(true)}
        >
          <span aria-hidden="true">…</span>
        </button>
      }
    >
      {/* spec:impl meeting-card#render-meeting-client-archived-client */}
      <article
        className="meeting-panel meeting-detail"
        data-type={meeting.type}
        data-archived={archived}
      >
        {/* spec:impl meeting-card#show-status-label-header-status-planned */}
        <header className="meeting-status">
          <span className="meeting-status-pill">
            {meeting.status === "completed" && <span aria-hidden="true">✓ </span>}
            {t(meetingStatusLabels[meeting.status])}
          </span>
          {missed && (
            <>
              <p className="meeting-hint">{t("card.hours_not_counted")}</p>
              {!mutual && (
                <p className="meeting-hint">
                  {t(meeting.charged ? "card.charged" : "card.not_charged")}
                </p>
              )}
            </>
          )}
        </header>
        {/* spec:impl meeting-card#open-client-card-leader-taps */}
        {clientRef && (
          <button
            type="button"
            className="meeting-client"
            onClick={() => navigate(clientPath(clientRef.id))}
          >
            <ClientAvatar
              clientId={clientRef.id}
              name={clientRef.name}
              photoUrl={clientRef.photo_url}
            />
            <strong>{clientRef.name}</strong>
            <span aria-hidden="true">›</span>
          </button>
        )}
        {meeting.source === "self_booked" && (
          <div className="meeting-field">
            <strong>{t("card.self_booked")}</strong>
            {meeting.client_comment && <p>{meeting.client_comment}</p>}
          </div>
        )}
        {/* spec:impl meeting-card#show-filled-field-meeting-f03 */}
        <div className="meeting-read-fields">
          {field("form.date", date)}
          {field("form.start", time, clientTime)}
          {field("form.duration", t("public.duration", { N: meeting.duration_minutes }))}
          {meeting.my_duration_minutes !== null &&
            field("form.my_duration", t("public.duration", { N: meeting.my_duration_minutes }))}
          {meeting.actual_duration_minutes !== null &&
            field(
              "outcome.actual_duration",
              t("public.duration", { N: meeting.actual_duration_minutes }),
            )}
          {field("form.with_whom", meeting.with_whom)}
          {field("form.topic", meeting.topic)}
          {field("extra.meeting_place", place)}
          {field(
            meeting.place === "online" ? "form.link" : "form.address",
            meeting.place === "online" ? meeting.meeting_link : meeting.address,
          )}
          {/* spec:impl meeting-card#show-next-price-client-session */}
          {/* spec:impl meeting-card#show-price-currency-payment-type */}
          {!mutual && meeting.price && (
            <div className="meeting-field meeting-read">
              <span>{t("form.price")}</span>
              <strong>{formatMoney(meeting.price, language)}</strong>
              {meeting.type === "client_session" &&
                meeting.payment_type &&
                meeting.payment_type !== "paid" && (
                  <small>
                    {t(meeting.payment_type === "barter" ? "form.barter" : "form.pro_bono")}
                  </small>
                )}
            </div>
          )}
          {field("form.comment", meeting.comment)}
        </div>
        {/* spec:impl meeting-card#show-contact-buttons-personal-therapy */}
        {client && !archived && (
          <div className="client-quick-actions meeting-contact-actions">
            {/* spec:impl meeting-card#build-contact-buttons-client-session */}
            {/* spec:impl meeting-card#show-contact-button-contact-empty */}
            {/* spec:impl meeting-card#replace-contact-buttons-no-contacts-link */}
            {hasContacts ? (
              <ContactButtons contacts={client} preferred={client.preferred_channel} />
            ) : (
              <button
                type="button"
                className="shell-secondary"
                onClick={() => navigate(clientPath(client.id))}
              >
                {t("card.no_contacts")}
              </button>
            )}
          </div>
        )}
        {/* spec:impl meeting-card#highlight-one-main-action-large */}
        {/* spec:impl meeting-card#open-meeting-link-open-meeting-app */}
        {/* spec:impl meeting-outcome-recording#show-add-outcome-meeting-card-meeting */}
        {addOutcome ? (
          <button
            type="button"
            className="shell-primary"
            onClick={() => navigate(href + "/outcome")}
          >
            {t("card.add_outcome")}
          </button>
        ) : scheduled && link ? (
          <a className="shell-primary meeting-join" href={link} target="_blank" rel="noreferrer">
            {t("card.open_meeting")}
          </a>
        ) : null}
        <div className="meeting-secondary-actions">
          {scheduled && addOutcome && link && (
            <a
              className="shell-secondary meeting-join"
              href={link}
              target="_blank"
              rel="noreferrer"
            >
              {t("card.open_meeting")}
            </a>
          )}
          {!scheduled && !archived && (
            <button
              className="shell-secondary"
              type="button"
              onClick={() => navigate(href + "/outcome")}
            >
              {t("card.change_outcome")}
            </button>
          )}
          {scheduled && !archived && meeting.type === "client_session" && meeting.invite_url && (
            <button type="button" className="shell-secondary" onClick={() => void share()}>
              {t("card.share_link")}
            </button>
          )}
          {!archived && (
            <button type="button" className="shell-secondary" onClick={writeNote}>
              {t("card.write_note")}
            </button>
          )}
        </div>
        {copied && <p role="status">{t("profile.link_copied")}</p>}
        {error && (
          <p role="alert" className="meeting-error">
            {t(error)}
          </p>
        )}
      </article>
      {/* spec:impl meeting-card#hand-edit-meeting-form-reschedule */}
      {menu && (
        <Sheet title={t("extra.meeting_actions")} onClose={() => setMenu(false)}>
          <div className="meeting-modal-actions">
            {scheduled && !archived && (
              <button
                className="shell-secondary"
                type="button"
                onClick={() => navigate(href + "/edit?reschedule=1")}
              >
                {t("card.reschedule")}
              </button>
            )}
            <button
              className="shell-secondary"
              type="button"
              onClick={() => navigate(href + "/edit")}
            >
              {t("card.edit")}
            </button>
            {!archived && (
              <button
                className="shell-destructive"
                type="button"
                onClick={() => {
                  setMenu(false);
                  setChange(true);
                }}
              >
                {t(scheduled ? "card.cancel" : "card.delete")}
              </button>
            )}
          </div>
        </Sheet>
      )}
      {change && !archived && (
        <MeetingChangeSheet
          meeting={meeting}
          onClose={() => setChange(false)}
          onRemoved={() => router.replace(meetingsPath)}
        />
      )}
    </MeetingScreen>
  );
}
