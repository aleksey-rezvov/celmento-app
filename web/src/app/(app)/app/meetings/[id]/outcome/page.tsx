"use client";

import { useParams, useSearchParams } from "next/navigation";
import { Suspense, type ReactElement } from "react";
import { clientArchivePath } from "@/components/clients/card/ClientCardScreen";
import { MeetingResource } from "@/components/meetings/MeetingScreen";
import { OutcomeForm } from "@/components/meetings/OutcomeForm";

function MeetingOutcome(): ReactElement {
  const { id } = useParams<{ id: string }>();
  const params = useSearchParams();
  const query = params.get("status");
  const status = query === "completed" || query === "not_taken_place" ? query : null;
  const from = params.get("from");

  return (
    <MeetingResource id={id}>
      {(meeting) => {
        // spec:impl client-archive-restore#run-usual-outcome-flow-buttons
        const back =
          from === "archive" && meeting.client
            ? clientArchivePath(meeting.client.id)
            : from === "pending"
              ? "/app/meetings/pending"
              : undefined;
        return <OutcomeForm key={meeting.id} meeting={meeting} status={status} back={back} />;
      }}
    </MeetingResource>
  );
}

export default function MeetingOutcomePage(): ReactElement {
  return (
    <Suspense fallback={<div aria-busy="true" />}>
      <MeetingOutcome />
    </Suspense>
  );
}
