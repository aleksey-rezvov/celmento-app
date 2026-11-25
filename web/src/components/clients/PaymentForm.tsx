"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent, type ReactElement } from "react";
import { Character } from "@/components/Character";
import { useProfileLeaveGuard } from "@/components/profile/ProfileLeaveGuard";
import { ConfirmSheet } from "@/components/shell/ConfirmSheet";
import { useAppNavigation } from "@/components/shell/navigation";
import { useAccount } from "@/lib/account";
import { apiClient, type Schemas } from "@/lib/api/client";
import { formatMoney } from "@/lib/format";
import { useIdempotencyKey } from "@/lib/idempotency";
import { useLanguage, useTranslation, type MessageKey } from "@/lib/i18n";
import { getSessionToken } from "@/lib/session";
import { normalizeClientRate, validRateInput } from "./RateCurrencyFields";
import { ClientScreen, clientPath } from "./card/ClientCardScreen";
import { accountDate, cents, decimalAmount } from "./card/card-money";

type Card = Schemas["ClientCard"];
type Operation = Schemas["BalanceOperation"];
type Money = Schemas["Money"];

const quickAmounts = [
  [1n, "payment.quick_1"],
  [5n, "payment.quick_5"],
  [10n, "payment.quick_10"],
] as const;

export function editablePayment(card: Card, operation: Operation): boolean {
  return card.status === "active" && operation.kind === "payment" && operation.editable;
}

interface PaymentFormProps {
  card: Card;
  currentBalance: Money;
  payment?: Operation;
}

export function PaymentForm({ card, currentBalance, payment }: PaymentFormProps): ReactElement {
  const { account } = useAccount();
  const t = useTranslation();
  const language = useLanguage();
  const router = useRouter();
  const navigate = useAppNavigation();
  const href = clientPath(card.id);
  const back = payment ? href + "/balance" : href;
  const today = accountDate(new Date(), account.time_zone);
  const [amount, setAmount] = useState(payment?.amount.amount ?? "");
  const [date, setDate] = useState(payment?.date ?? today);
  const [comment, setComment] = useState(payment?.comment ?? "");
  const [busy, setBusy] = useState(false);
  const idempotency = useIdempotencyKey();
  const [savedBalance, setSavedBalance] = useState<Money | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  const formatted = normalizeClientRate(amount);
  const rate = card.rate === null ? 0n : cents(card.rate);
  const dirty =
    savedBalance === null &&
    (amount !== (payment?.amount.amount ?? "") ||
      date !== (payment?.date ?? today) ||
      comment !== (payment?.comment ?? ""));
  const valid =
    formatted !== null &&
    validRateInput(amount) &&
    cents(formatted) > 0n &&
    Boolean(date) &&
    date <= today;
  const canChange = payment
    ? editablePayment(card, payment)
    : card.status === "active" && card.payment_type === "paid";

  async function save(): Promise<boolean> {
    if (!valid || !formatted || busy || !canChange) return false;
    setBusy(true);
    setError(null);
    try {
      const api = apiClient(getSessionToken());
      const body: Schemas["ClientPaymentCreate"] = {
        amount: formatted,
        date,
        comment: comment || null,
      };
      const result = payment
        ? await api.PATCH("/clients/{client_id}/payments/{payment_id}", {
            params: { path: { client_id: card.id, payment_id: payment.id } },
            body,
          })
        : await api.POST("/clients/{client_id}/payments", {
            params: {
              path: { client_id: card.id },
              header: { "Idempotency-Key": idempotency.keyFor(body) },
            },
            body,
          });

      if (!result.data) {
        setError("extra.auth_request_failed");
        return false;
      }
      if (!payment) {
        idempotency.clear();
        setSavedBalance(result.data.balance.balance);
      }
      return true;
    } catch {
      setError("extra.auth_network_error");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function remove(): Promise<void> {
    if (!payment || busy || !canChange) return;

    setBusy(true);
    setError(null);
    try {
      const { data } = await apiClient(getSessionToken()).DELETE(
        "/clients/{client_id}/payments/{payment_id}",
        {
          params: { path: { client_id: card.id, payment_id: payment.id } },
        },
      );
      if (data) router.replace(back);
      else setError("extra.auth_request_failed");
    } catch {
      setError("extra.auth_network_error");
    } finally {
      setBusy(false);
      setConfirmDelete(false);
    }
  }

  const leave = useProfileLeaveGuard({ dirty, saving: busy, valid, save });
  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void save().then((saved) => {
      if (saved && payment) router.replace(back);
    });
  }

  if (savedBalance) {
    return (
      <main className="client-card-screen client-payment-saved">
        <Character state="payment_saved" size={160} />
        <div className="client-form">
          <h1>
            {t("payment.saved", {
              [language === "ru" ? "сумма" : "amount"]: formatMoney(savedBalance, language),
            })}
          </h1>
          <button type="button" className="shell-primary" onClick={() => navigate(href)}>
            {t("extra.close")}
          </button>
        </div>
      </main>
    );
  }

  if (!canChange) {
    return (
      <ClientScreen title={t("payment.title")} back={back}>
        <p>{t("extra.auth_request_failed")}</p>
      </ClientScreen>
    );
  }

  const projected = cents(currentBalance.amount) - (payment ? cents(payment.amount.amount) : 0n);
  const confirmText =
    t("payment.delete_confirm") +
    (projected < 0n
      ? ". " +
        t("payment.balance_will_be", {
          [language === "ru" ? "сумма" : "amount"]: formatMoney(
            { ...currentBalance, amount: decimalAmount(projected) },
            language,
          ),
        })
      : "");

  return (
    <ClientScreen title={t("payment.title")} back={back}>
      {/* spec:impl client-balance-payments#open-form-6-5-titled-add-payment */}
      <form className="client-form" onSubmit={submit}>
        <fieldset disabled={busy} className="client-form-fields">
          <div className="shell-field-group">
            <label className="client-field">
              <span>
                {t("payment.amount")} · {payment?.amount.currency ?? card.currency}
              </span>
              <input
                type="text"
                inputMode="decimal"
                required
                value={amount}
                onChange={(event) => setAmount(event.currentTarget.value)}
              />
            </label>
            {/* spec:impl client-balance-payments#show-quick-1-quick-5-quick-10-amount */}
            {rate > 0n && (
              <div className="client-field shell-chips">
                {quickAmounts.map(([multiple, key]) => (
                  <button
                    key={key}
                    className="shell-chip"
                    type="button"
                    onClick={() => setAmount(decimalAmount(rate * multiple))}
                  >
                    {t(key)}
                  </button>
                ))}
              </div>
            )}
            <label className="client-field">
              <span>{t("payment.date")}</span>
              <input
                type="date"
                required
                max={today}
                value={date}
                onChange={(event) => setDate(event.currentTarget.value)}
              />
            </label>
            <label className="client-field">
              <span>{t("payment.comment")}</span>
              <textarea
                rows={3}
                placeholder={t("payment.comment_hint")}
                value={comment}
                onChange={(event) => setComment(event.currentTarget.value)}
              />
            </label>
          </div>
        </fieldset>
        {error && (
          <p className="client-error" role="alert">
            {t(error)}
          </p>
        )}
        <button type="submit" className="shell-primary" disabled={!valid || busy}>
          {t("extra.client_save")}
        </button>
        {payment && (
          <button
            type="button"
            className="shell-destructive"
            disabled={busy}
            onClick={() => setConfirmDelete(true)}
          >
            {t("card.delete")}
          </button>
        )}
      </form>
      {leave.sheet}
      {/* spec:impl client-balance-payments#ask-delete-confirm-before-deleting */}
      {confirmDelete && (
        <ConfirmSheet
          title={t("extra.payment_delete_title")}
          text={confirmText}
          confirmLabel={t("card.delete")}
          destructive
          onConfirm={() => void remove()}
          onClose={() => !busy && setConfirmDelete(false)}
        />
      )}
    </ClientScreen>
  );
}
