"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, type ReactElement } from "react";
import { Character } from "@/components/Character";
import { usePlansJourney } from "@/components/plans/PlansJourney";
import { profilePlansHref } from "@/components/plans/plans-paths";
import { useAccount } from "@/lib/account";
import { useTranslation } from "@/lib/i18n";

export default function PlansSentPage(): ReactElement {
  const { account, currentSessionToken } = useAccount();
  const { receipt } = usePlansJourney();
  const router = useRouter();
  const t = useTranslation();
  const current = receipt?.accountId === account.id ? receipt : null;

  useEffect(() => {
    if (current === null && currentSessionToken()) router.replace(profilePlansHref);
  }, [current, currentSessionToken, router]);

  if (!current) return <main aria-busy="true" />;

  return (
    <main className="plans-page plans-outcome">
      {/* spec:impl subscription-plans-request#return-screen-10-2-screen-10-3 */}
      <Link className="shell-icon-button" href={current.plansHref} aria-label={t("extra.close")}>
        <span aria-hidden="true">×</span>
      </Link>
      <Character state="plans_thanks" size={200} />
      <section className="plans-card">
        <h1>{t("plans.thanks", { email: account.email, почта: account.email })}</h1>
      </section>
    </main>
  );
}
