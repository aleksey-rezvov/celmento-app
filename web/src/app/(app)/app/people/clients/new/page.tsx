"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, type ReactElement } from "react";
import { ClientForm } from "@/components/clients/ClientForm";
import { ScreenHeader } from "@/components/shell/ScreenHeader";
import { useAccount } from "@/lib/account";
import { useTranslation } from "@/lib/i18n";
import { newClientHref, newClientPath, peoplePath } from "@/lib/limit";

export default function NewClient(): ReactElement | null {
  const router = useRouter();
  const { account } = useAccount();
  const t = useTranslation();
  const leader = account.activated ? account.leader : null;
  const destination = leader ? newClientHref(leader.plan) : peoplePath;

  useEffect(() => {
    // spec:impl client-card-create#check-free-plan-limit-before
    if (destination !== newClientPath) router.replace(destination);
  }, [destination, router]);

  // spec:impl client-card-create#offer-card-creation-only-leader
  if (!leader || destination !== newClientPath) return null;

  return (
    <main>
      <ScreenHeader
        title={t("new.title")}
        back={
          <Link className="shell-icon-button" href={peoplePath} aria-label={t("extra.back")}>
            <span aria-hidden="true">←</span>
          </Link>
        }
      />
      {/* spec:impl client-card-create#open-creation-form-floating-people */}
      <ClientForm
        mode="full"
        defaults={{ rate: leader.default_rate, currency: leader.default_currency }}
        onCreated={(card) => {
          // spec:impl client-card-create#create-card-save-standalone-card
          router.replace(`${peoplePath}/clients/${encodeURIComponent(card.id)}`);
        }}
      />
    </main>
  );
}
