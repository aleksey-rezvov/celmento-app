"use client";

import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, type ReactElement } from "react";
import { MeetingForm } from "@/components/meetings/MeetingForm";
import { MeetingResource, meetingPath } from "@/components/meetings/MeetingScreen";
import { editableDraft } from "@/components/meetings/meeting-form-values";
import { useAccount } from "@/lib/account";
import { loadDraft } from "@/lib/meeting-draft";

function EditMeeting(): ReactElement {
  const { id } = useParams<{ id: string }>();
  const pathname = usePathname();
  const params = useSearchParams();
  const router = useRouter();
  const { account } = useAccount();
  return (
    <MeetingResource id={id}>
      {(meeting) => {
        const draft = params.get("resume") === "1" ? loadDraft(account.id, pathname) : null;
        return (
          // spec:impl meeting-form#open-form-filled-meeting-current
          // spec:impl meeting-reschedule-cancel-delete#open-meeting-form-meeting-fields
          <MeetingForm
            key={meeting.id}
            original={meeting}
            initial={draft ?? editableDraft(account, meeting)}
            focusDate={params.get("reschedule") === "1" && meeting.status === "scheduled"}
            resumed={draft !== null}
            onSaved={(updated) => router.replace(meetingPath(updated.id))}
          />
        );
      }}
    </MeetingResource>
  );
}

export default function EditMeetingPage(): ReactElement {
  return (
    <Suspense fallback={<div aria-busy="true" />}>
      <EditMeeting />
    </Suspense>
  );
}
