"use client";

import type { ReactElement } from "react";
import { currencies, currencyOptions, normalizeRate } from "@/components/profile/profile-edit";
import { ChoiceChips } from "@/components/shell/ChoiceChips";
import type { Schemas } from "@/lib/api/client";
import { formatMoney } from "@/lib/format";
import { useLanguage, useTranslation, type MessageKey } from "@/lib/i18n";

interface RateCurrencyFieldsProps {
  rate: string;
  currency: Schemas["Currency"];
  onRateChange: (rate: string) => void;
  onCurrencyChange: (currency: Schemas["Currency"]) => void;
  rateLabel?: MessageKey;
  currencyLabel?: MessageKey;
  disabled?: boolean;
  lockedBalance?: Schemas["Money"];
  currencyChanged?: boolean;
}

export function normalizeClientRate(value: string): string | null {
  return normalizeRate(value);
}

export function validRateInput(value: string): boolean {
  const normalized = normalizeClientRate(value);
  return normalized === null || /^[0-9]{1,15}(?:\.[0-9]{1,2})?$/u.test(normalized);
}

export function RateCurrencyFields({
  rate,
  currency,
  onRateChange,
  onCurrencyChange,
  rateLabel = "new.rate",
  currencyLabel = "client.currency",
  disabled,
  lockedBalance,
  currencyChanged,
}: RateCurrencyFieldsProps): ReactElement {
  const t = useTranslation();
  const language = useLanguage();
  const currencyText = t(currencyLabel);

  return (
    <fieldset disabled={disabled} className="client-rate-fields">
      <label className="client-field">
        <span>{t(currencyChanged ? "client.currency_new_rate" : rateLabel)}</span>
        <input
          type="text"
          inputMode="decimal"
          value={rate}
          required={currencyChanged}
          onChange={(event) => onRateChange(event.currentTarget.value)}
        />
      </label>
      <div className="client-field">
        <span>{currencyText}</span>
        <ChoiceChips
          options={currencyOptions.map((value) => ({
            value,
            label: currencies[value],
            disabled: lockedBalance !== undefined,
          }))}
          label={currencyText}
          value={currency}
          onChange={onCurrencyChange}
        />
        {/* spec:impl client-rate-currency#lock-currency-field-screen-6-2 */}
        {lockedBalance && (
          <p className="client-hint">
            {t("client.currency_locked", {
              [language === "ru" ? "сумма" : "amount"]: formatMoney(lockedBalance, language),
            })}
          </p>
        )}
      </div>
    </fieldset>
  );
}
