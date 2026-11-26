"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState, type ReactElement } from "react";
import { PlanCard } from "@/components/plans/PlanCard";
import { usePlansJourney } from "@/components/plans/PlansJourney";
import { TermToggle } from "@/components/plans/TermToggle";
import {
  existingSubscriptionRequest,
  useApplyPlanStatus,
  useLivePlan,
  usePlansOverview,
} from "@/components/plans/plans-data";
import { plansEntry, plansSentPath } from "@/components/plans/plans-paths";
import { ScreenHeader } from "@/components/shell/ScreenHeader";
import { useAccount } from "@/lib/account";
import { apiClient, errorCode, type Schemas } from "@/lib/api/client";
import { formatDate, formatMoney } from "@/lib/format";
import { useLanguage, useTranslation, type MessageKey } from "@/lib/i18n";

type Overview = Schemas["PlansOverview"];
type Term = Schemas["SubscriptionTerm"];
type Currency = Schemas["Currency"];
type SubscriptionRequest = Schemas["SubscriptionRequest"];

interface PlanOptionsProps {
  overview: Overview;
  entry: ReturnType<typeof plansEntry>;
}

function monthlyEquivalent(yearly: Schemas["Money"]): Schemas["Money"] {
  return { ...yearly, amount: (Number(yearly.amount) / 12).toFixed(2) };
}

function PlanOptions({ overview, entry }: PlanOptionsProps): ReactElement {
  const { account, currentSessionToken } = useAccount();
  const language = useLanguage();
  const t = useTranslation();
  const router = useRouter();
  const { receipt, received } = usePlansJourney();
  const [term, setTerm] = useState<Term>("month");
  const [busy, setBusy] = useState(false);
  const [duplicate, setDuplicate] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  const pending = useRef<AbortController | null>(null);
  // spec:impl subscription-plans-request#choose-price-currency-account-contour
  // spec:impl subscription-plans-request#show-prices-dollars-currency-other
  const currency: Currency = account.contour === "ru" ? "RUB" : "EUR";
  const offers = overview.prices.items.filter(({ price }) => price.currency === currency);
  const monthly = offers.find((item) => item.term === "month")?.price;
  const yearly = offers.find((item) => item.term === "year")?.price;
  const price = term === "year" ? yearly : monthly;
  const current = account.leader?.plan ?? overview.plan;
  const requestedAt =
    account.leader?.subscription_requested_at ??
    overview.request?.created_at ??
    (receipt?.accountId === account.id ? receipt.request.created_at : null);

  useEffect(() => () => pending.current?.abort(), []);

  function showReceipt(request: SubscriptionRequest): void {
    received({ accountId: account.id, request, plansHref: entry.href });
    // spec:impl subscription-plans-request#show-want-subscription-card-open
    router.push(plansSentPath);
  }

  async function requestSubscription(): Promise<void> {
    if (pending.current || requestedAt || duplicate || !price) return;
    const token = currentSessionToken();
    if (!token) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setError(null);

    try {
      // spec:impl subscription-plans-request#store-request-account-contour-account
      const {
        data,
        error: failure,
        response,
      } = await apiClient(token).POST("/subscription-requests", {
        body: { term, source: entry.source },
        signal: controller.signal,
      });
      if (controller.signal.aborted || currentSessionToken() !== token) return;

      const request =
        data ?? (response.status === 409 ? existingSubscriptionRequest(failure, currency) : null);
      if (request) {
        showReceipt(request);
      } else {
        if (errorCode(failure) === "subscription_request_exists") setDuplicate(true);
        setError("extra.auth_request_failed");
      }
    } catch {
      if (!controller.signal.aborted && currentSessionToken() === token) {
        setError("extra.auth_network_error");
      }
    } finally {
      pending.current = null;
      if (!controller.signal.aborted && currentSessionToken() === token) setBusy(false);
    }
  }

  const requestDate =
    requestedAt && formatDate(requestedAt, account.time_zone, language, { year: "numeric" });
  const equivalent = yearly ? formatMoney(monthlyEquivalent(yearly), language) : null;

  // spec:impl subscription-plans-request#show-two-cards-screen-10-2
  // spec:impl subscription-plans-request#take-payment-show-payment-form
  return (
    <>
      <PlanCard kind="free" current={current.kind === "free"} />
      <PlanCard kind="subscription" current={current.kind === "subscription"}>
        <TermToggle term={term} busy={busy} onChange={setTerm} />
        {/* spec:impl subscription-plans-request#show-monthly-price-month-selected */}
        {price && (
          <div className="plans-price-line">
            <p className="plans-price">{formatMoney(price, language)}</p>
            {term === "year" && equivalent && (
              <>
                <p>{t("plans.per_month", { amount: equivalent, сумма: equivalent })}</p>
                <p className="plans-hint">{t("plans.year_hint")}</p>
              </>
            )}
          </div>
        )}
        {(error || !price) && <p role="alert">{t(error ?? "extra.auth_request_failed")}</p>}
        {/* spec:impl subscription-plans-request#replace-want-request-sent-showing */}
        {requestDate ? (
          <p className="plans-hint">
            {t("plans.request_sent", { date: requestDate, дата: requestDate })}
          </p>
        ) : (
          !duplicate && (
            <button
              className="shell-primary"
              type="button"
              disabled={busy || !price}
              onClick={() => void requestSubscription()}
            >
              {t("plans.want")}
            </button>
          )
        )}
      </PlanCard>
    </>
  );
}

function Plans(): ReactElement {
  const t = useTranslation();
  const entry = plansEntry(useSearchParams());
  const result = usePlansOverview();
  const applied = useApplyPlanStatus(result?.data?.plan ?? null);
  useLivePlan(applied);

  return (
    <main className="plans-page">
      <ScreenHeader
        title={t("plans.title")}
        back={
          <Link className="shell-icon-button" href={entry.back} aria-label={t("extra.back")}>
            <span aria-hidden="true">‹</span>
          </Link>
        }
      />
      {result?.data && applied ? (
        <PlanOptions overview={result.data} entry={entry} />
      ) : result?.error ? (
        <section className="plans-card">
          <p role="alert">{t(result.error)}</p>
        </section>
      ) : (
        <div className="plans-loading" aria-busy="true" />
      )}
    </main>
  );
}

export default function PlansPage(): ReactElement {
  return (
    <Suspense fallback={<main aria-busy="true" />}>
      <Plans />
    </Suspense>
  );
}
