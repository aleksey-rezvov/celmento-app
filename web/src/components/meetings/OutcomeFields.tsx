"use client";

import type { ReactElement } from "react";
import { isZeroClientRate, PaymentTypeChips } from "@/components/clients/PaymentTypeChips";
import { normalizeClientRate, validRateInput } from "@/components/clients/RateCurrencyFields";
import { ChoiceChips } from "@/components/shell/ChoiceChips";
import type { Schemas } from "@/lib/api/client";
import { useTranslation } from "@/lib/i18n";
import type { OutcomeDraft } from "@/lib/meeting-draft";
import { DurationField, minutes } from "./DurationField";

export const outcomeOptions = [
  { value: "completed", label: "outcome.done" },
  { value: "not_taken_place", label: "outcome.missed" },
] as const;

type Type = Schemas["MeetingType"];
type OutcomeInput = Schemas["MeetingOutcomeInput"];

export function chargeQuestion(type: Type, payment: OutcomeDraft["paymentType"]): boolean {
  return type !== "mutual_practice" && (type !== "client_session" || payment === "paid");
}

export function outcomeInput(draft: OutcomeDraft, type: Type): OutcomeInput | null {
  const client = type === "client_session";
  const mutual = type === "mutual_practice";
  if (draft.status === "not_taken_place") {
    if (!chargeQuestion(type, draft.paymentType)) return { status: draft.status };
    return draft.charged !== null ? { status: draft.status, charged: draft.charged } : null;
  }
  const duration = minutes(draft.duration);
  if (duration === null) return null;

  const base: OutcomeInput = { status: draft.status, actual_duration_minutes: duration };
  if (mutual) return base;
  const price = normalizeClientRate(draft.price);
  if (price === null || !validRateInput(draft.price)) return null;
  if (client && (!draft.paymentType || (draft.paymentType === "paid" && isZeroClientRate(price))))
    return null;

  return client && draft.paymentType
    ? { ...base, price, payment_type: draft.paymentType }
    : { ...base, price };
}

interface OutcomeFieldsProps {
  draft: OutcomeDraft;
  type: Type;
  currency: Schemas["Currency"] | null;
  onChange: (draft: OutcomeDraft) => void;
}

export function OutcomeFields({
  draft,
  type,
  currency,
  onChange,
}: OutcomeFieldsProps): ReactElement | null {
  const t = useTranslation();
  const client = type === "client_session";
  const mutual = type === "mutual_practice";

  if (draft.status === "not_taken_place") {
    if (!chargeQuestion(type, draft.paymentType)) return null;
    const question = t(client ? "outcome.charge_q" : "outcome.expense_q");

    // spec:impl meeting-outcome-recording#open-screen-4-3-after-missed
    return (
      <div className="meeting-field">
        <strong>{question}</strong>
        {client && <p className="meeting-hint">{t("outcome.charge_hint")}</p>}
        <ChoiceChips
          label={question}
          options={[
            { value: "yes", label: t("outcome.yes") },
            { value: "no", label: t("outcome.no") },
          ]}
          value={draft.charged === null ? null : draft.charged ? "yes" : "no"}
          onChange={(value) => onChange({ ...draft, charged: value === "yes" })}
        />
      </div>
    );
  }

  return (
    <div className="meeting-outcome-fields">
      {/* spec:impl meeting-outcome-recording#open-screen-4-2-after-done */}
      {/* spec:impl mutual-practice-meeting#open-after-done-completion-screen */}
      <DurationField
        label="outcome.actual_duration"
        value={draft.duration}
        onChange={(duration) => onChange({ ...draft, duration })}
      />
      {!mutual && (
        <label className="meeting-field">
          <span>
            {t("form.price")}
            {currency && " · " + currency}
          </span>
          <input
            type="text"
            inputMode="decimal"
            value={draft.price}
            onChange={(event) => {
              const price = event.currentTarget.value;
              onChange({
                ...draft,
                price,
                paymentType:
                  isZeroClientRate(price) && draft.paymentType === "paid"
                    ? null
                    : draft.paymentType,
              });
            }}
          />
        </label>
      )}
      {client && (
        <PaymentTypeChips
          price={draft.price}
          value={draft.paymentType}
          onChange={(paymentType) => onChange({ ...draft, paymentType })}
        />
      )}
    </div>
  );
}
