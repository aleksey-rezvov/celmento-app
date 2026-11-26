import type { ReactElement } from "react";
import { EmptyState } from "@/components/shell/EmptyState";
import { peoplePath } from "@/lib/limit";

interface AttendeeEmptyProps {
  specialistsCount: number;
}

export function AttendeeEmpty({ specialistsCount }: AttendeeEmptyProps): ReactElement {
  // spec:impl attended-meetings#show-account-without-activation-no-attended
  return (
    <EmptyState
      character="attendee_meetings_empty"
      textKey="c.no_bookings"
      action={{
        labelKey: specialistsCount > 0 ? "form.book" : "c.find_specialist",
        href: peoplePath,
      }}
    />
  );
}
