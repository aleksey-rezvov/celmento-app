"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, type ReactElement } from "react";
import { Character } from "@/components/Character";
import { useTranslation } from "@/lib/i18n";
import { limitReturnPath, peoplePath } from "@/lib/limit";

function LimitMessage(): ReactElement {
  const query = useSearchParams();
  const t = useTranslation();
  const name = query.get("clientName");
  const message =
    query.get("reason") === "restore" && name
      ? t("limit.restore", { name, имя: name })
      : t("limit.new_client");

  return (
    <main className="grid gap-4">
      <Link
        className="shell-icon-button"
        href={limitReturnPath(query.get("returnTo"))}
        aria-label={t("extra.back")}
      >
        <span aria-hidden="true">←</span>
      </Link>
      {/* spec:impl character-illustrations#show-celmento-master-blue-celmento-master-red */}
      <Character state="plan_limit_pair" size={172} />
      <section className="grid justify-items-start gap-4 rounded-3xl bg-white p-5">
        <h1 className="text-2xl leading-tight font-bold [font-family:var(--font-title)]">
          {message}
        </h1>
        <Link className="shell-secondary" href={peoplePath}>
          {t("limit.open_clients")}
        </Link>
        <p className="text-sm text-[var(--color-secondary)]">{t("limit.history_kept")}</p>
      </section>
    </main>
  );
}

export default function Limit(): ReactElement {
  return (
    <Suspense fallback={<main aria-busy="true" />}>
      <LimitMessage />
    </Suspense>
  );
}
