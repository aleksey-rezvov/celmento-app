"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent, type ReactElement } from "react";
import { ClientForm } from "@/components/clients/ClientForm";
import { isZeroClientRate, PaymentTypeChips } from "@/components/clients/PaymentTypeChips";
import { currencies, currencyOptions } from "@/components/profile/profile-edit";
import { useProfileLeaveGuard } from "@/components/profile/ProfileLeaveGuard";
import { ChoiceChips } from "@/components/shell/ChoiceChips";
import { Sheet } from "@/components/shell/Sheet";
import { useAccount } from "@/lib/account";
import { apiClient, errorCode, type Schemas } from "@/lib/api/client";
import { formatTime } from "@/lib/format";
import { useIdempotencyKey } from "@/lib/idempotency";
import { useLanguage, useTranslation, type MessageKey } from "@/lib/i18n";
import { activeClientLimitReached, limitScreenHref } from "@/lib/limit";
import { putMeetingOutcome } from "@/lib/meeting-api";
import { clearDraft, saveDraft, type MeetingDraft } from "@/lib/meeting-draft";
import { meetingTypeLabels } from "@/lib/meeting-display";
import { useCurrentInstant } from "@/lib/schedule-view";
import { getSessionToken } from "@/lib/session";
import { ClientPicker } from "./ClientPicker";
import { DurationField, minutes } from "./DurationField";
import { MeetingScreen, meetingPath } from "./MeetingScreen";
import { OutcomeFields, outcomeOptions } from "./OutcomeFields";
import { meetingPayload, meetingStart } from "./meeting-form-values";

type Card = Schemas["ClientCard"];
type Detail = Schemas["MeetingDetail"];
type Type = Schemas["MeetingType"];
type Create = Schemas["MeetingCreate"];
type Currency = Schemas["Currency"];

type CurrencyLookup =
  | { key: string; state: "ready"; currency: Currency }
  | { key: string; state: "failed"; error: MessageKey };

const types: Type[] = [
  "client_session",
  "personal_therapy",
  "supervision",
  "mutual_practice",
  "training",
];

interface Overlap {
  start: string;
  person: string;
}

interface PartialSave {
  meeting: Detail;
  detailsKey: string;
}

function detailsKey(payload: Create): string {
  return JSON.stringify({
    ...payload,
    starts_at: new Date(payload.starts_at).toISOString(),
    allow_overlap: undefined,
    outcome: undefined,
  });
}

function clientPricing(
  client: NonNullable<MeetingDraft["client"]>,
  saved: Detail | undefined,
): Pick<MeetingDraft, "price" | "currency" | "paymentType"> {
  const historical = saved?.client?.id === client.id ? saved : null;
  const price = historical?.price?.amount ?? client.rate ?? "0";
  const payment = historical?.payment_type ?? client.payment_type;
  return {
    price,
    currency: historical?.price?.currency ?? client.currency,
    paymentType: isZeroClientRate(price) && payment === "paid" ? null : payment,
  };
}

function conflictDetails(failure: unknown, translate: (key: MessageKey) => string): Overlap | null {
  if (typeof failure !== "object" || failure === null || !("details" in failure)) return null;
  const details = failure.details;
  if (typeof details !== "object" || details === null || !("meeting" in details)) return null;
  const meeting = details.meeting;
  if (
    typeof meeting !== "object" ||
    meeting === null ||
    !("starts_at" in meeting) ||
    typeof meeting.starts_at !== "string" ||
    !Number.isFinite(Date.parse(meeting.starts_at))
  )
    return null;

  const type =
    "type" in meeting &&
    typeof meeting.type === "string" &&
    Object.hasOwn(meetingTypeLabels, meeting.type)
      ? meetingTypeLabels[meeting.type as Type]
      : "meetings.title";
  const client = "client" in meeting ? meeting.client : null;
  const person =
    client && typeof client === "object" && "name" in client && typeof client.name === "string"
      ? client.name
      : "with_whom" in meeting && typeof meeting.with_whom === "string" && meeting.with_whom
        ? meeting.with_whom
        : translate(type);
  return { start: meeting.starts_at, person };
}

interface MeetingFormProps {
  initial: MeetingDraft;
  original?: Detail;
  focusDate?: boolean;
  resumed?: boolean;
  onSaved: (meeting: Detail) => void;
}

export function MeetingForm({
  initial,
  original,
  focusDate,
  resumed,
  onSaved,
}: MeetingFormProps): ReactElement {
  const t = useTranslation();
  const language = useLanguage();
  const now = useCurrentInstant();
  const { account } = useAccount();
  const router = useRouter();
  const idempotency = useIdempotencyKey();
  const [draft, setDraft] = useState(initial);
  const [dialog, setDialog] = useState<"pick" | "new" | null>(null);
  const [overlap, setOverlap] = useState<{ details: Overlap; body: Create } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  const [partial, setPartial] = useState<PartialSave | null>(null);
  const [lookup, setLookup] = useState<CurrencyLookup | null>(null);
  const [currencyAttempt, setCurrencyAttempt] = useState(0);
  const dateInput = useRef<HTMLInputElement>(null);
  const timeInput = useRef<HTMLInputElement>(null);
  const place = t("extra.meeting_place");
  const isClient = draft.type === "client_session";
  const isMutual = draft.type === "mutual_practice";
  const savedMeeting = partial?.meeting ?? original;
  const archived = savedMeeting?.client?.archived === true;
  const fixedType = Boolean(savedMeeting && (savedMeeting.status !== "scheduled" || archived));
  const start = meetingStart(draft, account.time_zone, savedMeeting);
  const duration = minutes(draft.duration);
  const past = start !== null && Date.parse(start) <= now.getTime();
  const showOutcome = past && (!savedMeeting || savedMeeting.status === "scheduled") && !archived;
  const needsDefaultCurrency = !isClient && !isMutual && !draft.currencyPicked;
  const withWhom = draft.withWhom.trim();
  const lookupKey =
    needsDefaultCurrency && start
      ? JSON.stringify([account.id, draft.date, withWhom, currencyAttempt])
      : null;
  const currentLookup = lookup?.key === lookupKey ? lookup : null;
  const currency = needsDefaultCurrency
    ? currentLookup?.state === "ready"
      ? currentLookup.currency
      : null
    : draft.currency;
  const body =
    currency === null ? null : meetingPayload({ ...draft, currency }, start, showOutcome);
  const endAt = start && duration ? new Date(Date.parse(start) + duration * 60000) : null;
  const end =
    endAt && Number.isFinite(endAt.getTime())
      ? t("form.ends_at", {
          [language === "ru" ? "время" : "time"]: formatTime(
            endAt.toISOString(),
            account.time_zone,
            language,
          ),
        })
      : null;
  const details =
    partial && currency !== null
      ? (body ?? meetingPayload({ ...draft, currency }, start, false))
      : null;
  const detailsSaved = Boolean(partial && details && detailsKey(details) === partial.detailsKey);
  const outcomePending = showOutcome && draft.outcome !== null;
  const dirty = partial
    ? !detailsSaved || outcomePending
    : resumed === true || JSON.stringify(draft) !== JSON.stringify(initial);

  useEffect(() => {
    if (focusDate) dateInput.current?.focus();
  }, [focusDate]);

  useEffect(() => {
    if (!lookupKey) return;

    const controller = new AbortController();
    const token = getSessionToken();
    const key = lookupKey;
    async function loadCurrency(): Promise<void> {
      try {
        // spec:impl meeting-form#default-currency-personal-therapy
        const { data } = await apiClient(token).GET("/meetings/defaults", {
          params: { query: { date: draft.date, with_whom: withWhom || undefined } },
          signal: controller.signal,
          cache: "no-store",
        });
        if (controller.signal.aborted || getSessionToken() !== token) return;
        setLookup(
          data
            ? { key, state: "ready", currency: data.currency }
            : { key, state: "failed", error: "extra.auth_request_failed" },
        );
      } catch {
        if (!controller.signal.aborted && getSessionToken() === token) {
          setLookup({ key, state: "failed", error: "extra.auth_network_error" });
        }
      }
    }

    void loadCurrency();
    return () => controller.abort();
  }, [draft.date, lookupKey, withWhom]);

  function selectType(type: Type): void {
    if (type === draft.type || fixedType) return;
    setDraft((previous) => {
      const client = type === "client_session" ? previous.client : null;
      const pricing = client
        ? clientPricing(client, savedMeeting)
        : {
            price: type === "client_session" ? "" : "0",
            paymentType: null,
            currency: savedMeeting?.price?.currency ?? account.leader?.default_currency ?? "RUB",
          };
      return {
        ...previous,
        ...pricing,
        type,
        outcome: null,
        currencyPicked: original !== undefined,
      };
    });
  }

  function selectClient(card: Card): void {
    const client = {
      id: card.id,
      name: card.name,
      currency: card.currency,
      photo_url: card.photo_url,
      rate: card.rate,
      payment_type: card.payment_type,
    };
    // spec:impl meeting-form#fill-price-selected-client-rate
    setDraft((previous) =>
      previous.client?.id === card.id
        ? previous
        : {
            ...previous,
            ...clientPricing(client, savedMeeting),
            client,
            outcome: null,
          },
    );
    setDialog(null);
  }

  function limit(): void {
    const current = new URL(window.location.href);
    if (!saveDraft(account.id, current.pathname, draft)) {
      setDialog(null);
      setError("extra.auth_request_failed");
      return;
    }
    current.searchParams.set("resume", "1");
    setDialog(null);
    router.push(limitScreenHref("new_client", { returnTo: current.pathname + current.search }));
  }

  function newClient(): void {
    const plan = account.leader?.plan;
    // spec:impl client-card-create#run-limit-check-new-client-tapped
    if (plan && activeClientLimitReached(plan)) limit();
    else setDialog("new");
  }

  async function save(payload: Create | null = body, allowOverlap = false): Promise<boolean> {
    if (!payload || busy || end === null) return false;
    // spec:impl meeting-form#refuse-save-new-changed-meeting
    if (!navigator.onLine) {
      setError("extra.auth_network_error");
      return false;
    }
    const next = { ...payload, allow_overlap: allowOverlap };
    setError(null);
    setBusy(true);
    try {
      const api = apiClient(getSessionToken());
      let saved: Detail | null = null;
      if (savedMeeting) {
        const { outcome, type, client_id, ...fields } = next;
        const key = detailsKey(next);
        if (partial?.detailsKey === key) {
          saved = partial.meeting;
        } else {
          const update: Schemas["MeetingUpdate"] = { ...fields };
          if (type !== savedMeeting.type) update.type = type;
          if (client_id && client_id !== savedMeeting.client?.id) update.client_id = client_id;
          const result = await api.PATCH("/meetings/{meeting_id}", {
            params: { path: { meeting_id: savedMeeting.id } },
            body: update,
          });
          if (result.data) saved = result.data;
          else {
            const details =
              errorCode(result.error) === "meeting_overlap"
                ? conflictDetails(result.error, t)
                : null;
            if (details) setOverlap({ details, body: payload });
          }
        }

        if (saved && outcome) {
          setOverlap(null);
          setPartial({ meeting: saved, detailsKey: key });
          saved = await putMeetingOutcome(saved.id, outcome);
        }
      } else {
        const result = await api.POST("/meetings", {
          params: { header: { "Idempotency-Key": idempotency.keyFor(next) } },
          body: next,
        });
        if (result.data) {
          saved = result.data;
          idempotency.clear();
        } else {
          const details =
            errorCode(result.error) === "meeting_overlap" ? conflictDetails(result.error, t) : null;
          if (details) setOverlap({ details, body: payload });
        }
      }

      if (!saved) {
        setError("extra.auth_request_failed");
        return false;
      }
      setOverlap(null);
      setPartial(null);
      clearDraft(account.id, window.location.pathname);
      onSaved(saved);
      return true;
    } catch {
      setError("extra.auth_network_error");
      return false;
    } finally {
      setBusy(false);
    }
  }

  const leave = useProfileLeaveGuard({
    dirty,
    saving: busy,
    valid: body !== null && end !== null,
    save: () => save(),
    onDiscard: () => clearDraft(account.id, window.location.pathname),
  });

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void save();
  }

  const activeOutcome =
    draft.outcome?.status === "not_taken_place"
      ? { ...draft.outcome, paymentType: draft.paymentType }
      : draft.outcome;
  const overlapTitle = overlap
    ? t("form.overlap", {
        [language === "ru" ? "время" : "time"]: formatTime(
          overlap.details.start,
          account.time_zone,
          language,
        ),
        [language === "ru" ? "имя" : "name"]: overlap.details.person,
      })
    : "";
  const title = t(
    focusDate ? "card.reschedule" : original ? "card.edit" : "meetings.empty_day_cta",
  );

  return (
    <MeetingScreen title={title} back={original ? meetingPath(original.id) : undefined}>
      {/* spec:impl meeting-form#show-client-session-personal-therapy */}
      {/* spec:impl meeting-form#offer-types-type-session-type-therapy */}
      {/* spec:impl meeting-form#switch-form-mutual-practice-fields */}
      {/* spec:impl mutual-practice-meeting#show-mutual-practice-fields-with-whom */}
      <form className="meeting-panel" onSubmit={submit}>
        <fieldset className="meeting-form-fields" disabled={busy}>
          <div className="meeting-field">
            <strong>{t("form.type")}</strong>
            {/* spec:impl mutual-practice-meeting#offer-type-type-mutual-meeting-form */}
            <ChoiceChips
              label={t("form.type")}
              options={types.map((type) => ({
                value: type,
                label: t(meetingTypeLabels[type]),
                disabled: fixedType && type !== draft.type,
              }))}
              value={draft.type}
              onChange={selectType}
            />
          </div>
          {isClient ? (
            <button
              type="button"
              className="meeting-row-button"
              onClick={() => setDialog("pick")}
              disabled={fixedType}
            >
              <span>{t("form.client")}</span>
              <strong>{draft.client?.name ?? "—"}</strong>
              <span aria-hidden="true">›</span>
            </button>
          ) : (
            <div className="meeting-fields">
              <label className="meeting-field">
                <span>{t("form.with_whom")}</span>
                <input
                  value={draft.withWhom}
                  onChange={(event) => setDraft({ ...draft, withWhom: event.currentTarget.value })}
                />
              </label>
              <label className="meeting-field">
                <span>{t("form.topic")}</span>
                <input
                  value={draft.topic}
                  onChange={(event) => setDraft({ ...draft, topic: event.currentTarget.value })}
                />
              </label>
            </div>
          )}
          <div className="meeting-fields meeting-date-fields">
            <label className="meeting-field">
              <span>{t("form.date")}</span>
              <input
                ref={dateInput}
                type="date"
                required
                value={draft.date}
                onChange={(event) => setDraft({ ...draft, date: event.currentTarget.value })}
              />
            </label>
            <label className="meeting-field">
              <span>{t("form.start")}</span>
              <input
                ref={timeInput}
                type="time"
                required
                value={draft.start}
                onChange={(event) => setDraft({ ...draft, start: event.currentTarget.value })}
              />
            </label>
          </div>
          {draft.date && draft.start && !start && (
            <p role="alert" className="meeting-error">
              {t("extra.meeting_invalid_time")}
            </p>
          )}
          {/* spec:impl meeting-form#default-duration-profile-session */}
          {/* spec:impl meeting-form#accept-manually-entered-duration-longer */}
          <DurationField
            label="form.duration"
            value={draft.duration}
            end={end}
            onChange={(duration) => setDraft({ ...draft, duration })}
          />
          {/* spec:impl mutual-practice-meeting#require-my-duration-whole-number-minutes */}
          {isMutual && (
            <DurationField
              label="form.my_duration"
              value={draft.myDuration}
              onChange={(myDuration) => setDraft({ ...draft, myDuration })}
            />
          )}
          <div className="meeting-field">
            <strong>{place}</strong>
            <ChoiceChips
              label={place}
              options={[
                { value: "online", label: t("form.place_online") },
                { value: "in_person", label: t("form.place_offline") },
              ]}
              value={draft.place}
              onChange={(place) => setDraft({ ...draft, place })}
            />
          </div>
          {/* spec:impl meeting-form#preselect-place-online-show-link */}
          {draft.place === "online" ? (
            <label className="meeting-field">
              <span>{t("form.link")}</span>
              <input
                type="url"
                value={draft.link}
                onChange={(event) => setDraft({ ...draft, link: event.currentTarget.value })}
              />
            </label>
          ) : (
            <label className="meeting-field">
              <span>{t("form.address")}</span>
              <input
                value={draft.address}
                onChange={(event) => setDraft({ ...draft, address: event.currentTarget.value })}
              />
            </label>
          )}
          {!isMutual && (
            <div className="meeting-fields">
              {/* spec:impl meeting-form#show-selected-client-currency-next */}
              <label className="meeting-field">
                <span>
                  {t("form.price")}
                  {isClient && draft.client ? " · " + currency : null}
                </span>
                <input
                  value={draft.price}
                  inputMode="decimal"
                  onChange={(event) => {
                    const price = event.currentTarget.value;
                    // spec:impl meeting-form#make-paid-unavailable-price-client
                    setDraft({
                      ...draft,
                      price,
                      paymentType:
                        draft.paymentType === "paid" && isZeroClientRate(price)
                          ? null
                          : draft.paymentType,
                    });
                  }}
                />
              </label>
              {!isClient && (
                <div className="meeting-field">
                  <strong>{t("form.currency")}</strong>
                  <ChoiceChips
                    label={t("form.currency")}
                    value={currency}
                    options={currencyOptions.map((value) => ({ value, label: currencies[value] }))}
                    onChange={(currency) => setDraft({ ...draft, currency, currencyPicked: true })}
                  />
                  {currentLookup?.state === "failed" && (
                    <>
                      <p role="alert" className="meeting-error">
                        {t(currentLookup.error)}
                      </p>
                      <button
                        type="button"
                        className="shell-secondary"
                        onClick={() => setCurrencyAttempt(currencyAttempt + 1)}
                      >
                        {t("extra.auth_retry")}
                      </button>
                    </>
                  )}
                </div>
              )}
              {/* spec:impl meeting-form#show-client-session-payment-type */}
              {isClient && (
                <PaymentTypeChips
                  price={draft.price}
                  value={draft.paymentType}
                  onChange={(paymentType) => setDraft({ ...draft, paymentType })}
                />
              )}
            </div>
          )}
          {/* spec:impl meeting-form#keep-comment-optional-visible-leader */}
          <label className="meeting-field">
            <span>{t("form.comment")}</span>
            <textarea
              rows={3}
              value={draft.comment}
              onChange={(event) => setDraft({ ...draft, comment: event.currentTarget.value })}
            />
          </label>
          {/* spec:impl meeting-form#show-outcome-block-done-missed-only-entered */}
          {showOutcome && (
            <div className="meeting-fields">
              <div className="meeting-field">
                <strong>{t("form.outcome_block")}</strong>
                <ChoiceChips
                  label={t("form.outcome_block")}
                  options={outcomeOptions.map(({ value, label }) => ({ value, label: t(label) }))}
                  value={draft.outcome?.status ?? null}
                  onChange={(status) =>
                    setDraft({
                      ...draft,
                      outcome:
                        draft.outcome?.status === status
                          ? null
                          : {
                              status,
                              duration: isMutual ? draft.myDuration : draft.duration,
                              price: draft.price,
                              paymentType: draft.paymentType,
                              charged: null,
                            },
                    })
                  }
                />
              </div>
              {activeOutcome && (
                <OutcomeFields
                  draft={activeOutcome}
                  type={draft.type}
                  currency={isMutual ? null : currency}
                  onChange={(outcome) => setDraft({ ...draft, outcome })}
                />
              )}
            </div>
          )}
        </fieldset>
        {error && !overlap && (
          <p role="alert" className="meeting-error">
            {t(error)}
          </p>
        )}
        {detailsSaved && outcomePending && !busy && (
          <p role="status">{t("extra.meeting_details_saved_outcome_pending")}</p>
        )}
        {/* spec:impl meeting-form#enable-save-only-required-field */}
        {/* spec:impl mutual-practice-meeting#refuse-save-my-duration-greater-total */}
        <button className="shell-primary" type="submit" disabled={!body || end === null || busy}>
          {t("form.save")}
        </button>
      </form>
      {dialog === "pick" && (
        <ClientPicker
          onClose={() => setDialog(null)}
          onPick={selectClient}
          onNewClient={newClient}
        />
      )}
      {dialog === "new" && (
        // spec:impl client-card-create#open-short-form-new-client-client
        <Sheet title={t("new.title")} onClose={() => setDialog("pick")}>
          {/* spec:impl meeting-form#open-short-client-form-new-client */}
          {/* spec:impl client-card-create#create-card-short-form-saved */}
          <ClientForm
            mode="short"
            defaults={{
              rate: account.leader?.default_rate ?? null,
              currency: account.leader?.default_currency ?? "RUB",
            }}
            onCreated={selectClient}
            onLimitReached={limit}
          />
        </Sheet>
      )}
      {/* spec:impl meeting-form#show-overlap-time-name-existing */}
      {overlap && (
        <Sheet title={overlapTitle} onClose={() => setOverlap(null)}>
          <div className="meeting-modal-actions">
            <button
              type="button"
              className="shell-primary"
              disabled={busy}
              onClick={() => void save(overlap.body, true)}
            >
              {t("form.overlap_save")}
            </button>
            <button
              type="button"
              className="shell-secondary"
              disabled={busy}
              onClick={() => {
                setOverlap(null);
                setError(null);
                timeInput.current?.focus();
              }}
            >
              {t("form.overlap_change")}
            </button>
          </div>
        </Sheet>
      )}
      {leave.sheet}
    </MeetingScreen>
  );
}
