import type { ReactElement } from "react";
import type { Schemas } from "@/lib/api/client";
import { MeetingSurface } from "./MeetingBlock";

interface MeetingFeedCardProps {
  meeting: Schemas["Meeting"];
  timeZone: string;
  onOpen: (id: string) => void;
}

export function MeetingFeedCard(props: MeetingFeedCardProps): ReactElement {
  return <MeetingSurface {...props} feed />;
}
