"use client";

import { usePathname, useRouter } from "next/navigation";
import { useState, type FormEvent, type ReactElement } from "react";
import { GroupedField } from "@/components/shell/GroupedField";
import { useAccount } from "@/lib/account";
import { apiClient, errorCode, type Schemas } from "@/lib/api/client";
import { useTranslation, type MessageKey } from "@/lib/i18n";
import { useIdempotencyKey } from "@/lib/idempotency";
import { limitScreenHref, peoplePath } from "@/lib/limit";
import { getSessionToken } from "@/lib/session";
import { isZeroClientRate, PaymentTypeChips } from "./PaymentTypeChips";
import { normalizeClientRate, RateCurrencyFields, validRateInput } from "./RateCurrencyFields";
import "./client-form.css";

type Create = Schemas["ClientCreate"];
type PaymentType = Schemas["PaymentType"];
type Contacts = Required<Pick<Create, "phone" | "email" | "telegram" | "whatsapp">>;

const contactFields = [
  { field: "phone", label: "profile.phone", inputMode: "tel" },
  { field: "email", label: "extra.client_email", inputMode: "email" },
  { field: "telegram", label: "card.telegram", inputMode: "text" },
  { field: "whatsapp", label: "card.whatsapp", inputMode: "text" },
] as const satisfies readonly { field: keyof Contacts; label: MessageKey; inputMode: string }[];

interface ClientFormProps {
  mode: "full" | "short";
  defaults: { rate: string | null; currency: Schemas["Currency"] };
  onCreated: (card: Schemas["ClientCard"]) => void;
  onLimitReached?: () => void;
}

export function ClientForm({
  mode,
  defaults,
  onCreated,
  onLimitReached,
}: ClientFormProps): ReactElement {
  const { refresh } = useAccount();
  const router = useRouter();
  const pathname = usePathname();
  const t = useTranslation();
  const { keyFor, clear } = useIdempotencyKey();
  const [name, setName] = useState("");
  const [contacts, setContacts] = useState<Contacts>({
    phone: null,
    email: null,
    telegram: null,
    whatsapp: null,
  });
  const [rate, setRate] = useState(defaults.rate ?? "");
  const [currency, setCurrency] = useState(defaults.currency);
  const [payment, selectPayment] = useState<PaymentType | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<MessageKey | null>(null);
  const full = mode === "full";
  // spec:impl client-card-create#apply-payment-type-rules
  const paymentType = payment ?? (isZeroClientRate(rate) ? null : "paid");
  // spec:impl client-card-create#enable-save-button-only-name
  const canSave =
    name.trim().length > 0 && (!full || (validRateInput(rate) && paymentType !== null));

  async function save(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy || !canSave) return;

    const token = getSessionToken();
    if (token === null) {
      router.replace("/login");
      return;
    }

    const body: Create = { ...contacts, name: name.trim() };
    if (full && paymentType !== null) {
      body.rate = normalizeClientRate(rate);
      body.currency = currency;
      body.payment_type = paymentType;
    }

    setFailure(null);
    setBusy(true);
    try {
      const { data, error } = await apiClient(token).POST("/clients", {
        params: { header: { "Idempotency-Key": keyFor(body) } },
        body,
      });
      if (data) {
        clear();
        await refresh();
        onCreated(data);
        return;
      }

      if (errorCode(error) === "client_limit_reached") {
        await refresh();
        if (onLimitReached) {
          onLimitReached();
        } else {
          router.replace(limitScreenHref("new_client", { returnTo: full ? peoplePath : pathname }));
        }
        return;
      }

      setFailure("extra.auth_request_failed");
    } catch {
      setFailure("extra.auth_network_error");
    }
    setBusy(false);
  }

  // spec:impl client-card-create#show-screen-5-3-field-name
  // spec:impl client-card-create#offer-self-given-email-link-login-field
  // spec:impl client-card-create#ask-other-card-field-creation
  return (
    <form className="client-create-form" noValidate onSubmit={(event) => void save(event)}>
      <fieldset disabled={busy} className="client-create-fields">
        <GroupedField>
          <label className="client-field">
            <span>{t("new.name")}</span>
            <input value={name} required onChange={(event) => setName(event.currentTarget.value)} />
          </label>
        </GroupedField>

        <section className="client-create-contacts">
          <h2>{t("client.contacts_title")}</h2>
          <p className="client-hint">{t("client.contacts_hint")}</p>
          <GroupedField>
            {contactFields.map(({ field, label, inputMode }) => (
              <label key={field} className="client-field">
                <span>{t(label)}</span>
                <input
                  type="text"
                  inputMode={inputMode}
                  value={contacts[field] ?? ""}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    setContacts((previous) => ({
                      ...previous,
                      [field]: value === "" ? null : value,
                    }));
                  }}
                />
              </label>
            ))}
          </GroupedField>
        </section>

        {full && (
          <div className="client-create-pricing">
            <RateCurrencyFields
              rate={rate}
              currency={currency}
              rateLabel="new.rate"
              currencyLabel="new.currency"
              onRateChange={(value) => {
                if (isZeroClientRate(value) && payment === "paid") selectPayment(null);
                setRate(value);
              }}
              onCurrencyChange={setCurrency}
            />
            <p className="client-hint">{t("new.rate_hint")}</p>
            <PaymentTypeChips price={rate} value={paymentType} onChange={selectPayment} />
          </div>
        )}
      </fieldset>

      {failure && (
        <p className="clients-error" role="alert">
          {t(failure)}
        </p>
      )}
      <button
        type="submit"
        className="shell-primary client-create-submit"
        disabled={busy || !canSave}
      >
        {t("extra.client_save")}
      </button>
    </form>
  );
}
