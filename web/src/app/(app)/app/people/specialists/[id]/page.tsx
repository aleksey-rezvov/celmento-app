"use client";

import { useParams } from "next/navigation";
import type { ReactElement } from "react";
import { BookingLoadState } from "@/components/booking/BookingScreen";
import { SpecialistCardView } from "@/components/specialists/SpecialistCardView";
import { SpecialistScreen } from "@/components/specialists/SpecialistScreen";
import { useSpecialist } from "@/components/specialists/specialist-data";
import { useTranslation } from "@/lib/i18n";
import { peoplePath } from "@/lib/limit";

export default function SpecialistCardPage(): ReactElement {
  const { id } = useParams<{ id: string }>();
  const { result, retry } = useSpecialist(id);
  const t = useTranslation();

  return (
    <SpecialistScreen back={peoplePath} title={t("c.my_specialists")}>
      {result?.kind === "ready" ? (
        <SpecialistCardView key={result.data.specialist.id} card={result.data} />
      ) : result?.kind === "missing" ? (
        <p className="booking-card" role="status">
          {t("public.not_found")}
        </p>
      ) : (
        <BookingLoadState
          error={result?.kind === "offline" ? "offline" : result ? "error" : undefined}
          retry={retry}
        />
      )}
    </SpecialistScreen>
  );
}
