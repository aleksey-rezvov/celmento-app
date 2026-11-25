"use client";

import { useParams } from "next/navigation";
import type { ReactElement } from "react";
import { MeetingCardView } from "@/components/meetings/MeetingCardView";
import { MeetingResource } from "@/components/meetings/MeetingScreen";

export default function MeetingPage(): ReactElement {
  const { id } = useParams<{ id: string }>();
  return (
    <MeetingResource id={id}>
      {(meeting) => <MeetingCardView key={meeting.id} meeting={meeting} />}
    </MeetingResource>
  );
}
