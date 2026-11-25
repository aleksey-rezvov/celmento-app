"use client";

import { useParams } from "next/navigation";
import type { ReactElement } from "react";
import {
  ClientCardScreen,
  ClientScreen,
  clientPath,
} from "@/components/clients/card/ClientCardScreen";
import { ClientMeetingRows } from "@/components/clients/card/MeetingsBlock";
import { useTranslation } from "@/lib/i18n";

export default function ClientMeetingsPage(): ReactElement {
  const { id } = useParams<{ id: string }>();
  const t = useTranslation();
  return (
    <ClientCardScreen clientId={id}>
      {({ card }) => (
        <ClientScreen title={t("client.all_meetings")} back={clientPath(card.id)}>
          <ClientMeetingRows clientId={card.id} />
        </ClientScreen>
      )}
    </ClientCardScreen>
  );
}
