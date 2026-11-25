"use client";

import { useParams, useSearchParams } from "next/navigation";
import { Suspense, type ReactElement } from "react";
import { MeetingResource } from "@/components/meetings/MeetingScreen";
import { OutcomeForm } from "@/components/meetings/OutcomeForm";

function MeetingOutcome(): ReactElement {
  const { id } = useParams<{ id: string }>();
  const params = useSearchParams();
  const query = params.get("status");
  const status = query === "completed" || query === "not_taken_place" ? query : null;
  const back = params.get("from") === "pending" ? "/app/meetings/pending" : undefined;

  return (
    <MeetingResource id={id}>
      {(meeting) => <OutcomeForm key={meeting.id} meeting={meeting} status={status} back={back} />}
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
