"use client";

import type { ReactElement } from "react";
import { ChoiceChips } from "@/components/shell/ChoiceChips";
import type { Schemas } from "@/lib/api/client";
import { useTranslation, type MessageKey } from "@/lib/i18n";
import { normalizeClientRate, validRateInput } from "./RateCurrencyFields";

type PaymentType = Schemas["PaymentType"];

const choices = [
  { value: "paid", label: "form.paid" },
  { value: "barter", label: "form.barter" },
  { value: "pro_bono", label: "form.pro_bono" },
] as const satisfies readonly { value: PaymentType; label: MessageKey }[];

export function isZeroClientRate(price: string): boolean {
  const rate = normalizeClientRate(price);
  return rate !== null && validRateInput(price) && Number(rate) === 0;
}

interface PaymentTypeChipsProps {
  price: string;
  value: PaymentType | null;
  onChange: (value: PaymentType) => void;
}

export function PaymentTypeChips({ price, value, onChange }: PaymentTypeChipsProps): ReactElement {
  const t = useTranslation();
  const zero = isZeroClientRate(price);

  return (
    <ChoiceChips
      label={t("extra.client_payment_type")}
      value={zero && value === "paid" ? null : value}
      onChange={onChange}
      options={choices.map((choice) => ({
        value: choice.value,
        label: t(choice.label),
        disabled: zero && choice.value === "paid",
      }))}
    />
  );
}
