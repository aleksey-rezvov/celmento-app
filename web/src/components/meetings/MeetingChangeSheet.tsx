"use client";

import { useState, type ReactElement } from "react";
import { ChoiceChips } from "@/components/shell/ChoiceChips";
import { Sheet } from "@/components/shell/Sheet";
import { apiClient, type Schemas } from "@/lib/api/client";
import { useTranslation, type MessageKey } from "@/lib/i18n";
import { getSessionToken } from "@/lib/session";

interface MeetingChangeSheetProps {
  meeting: Schemas["MeetingDetail"];
  onClose: () => void;
  onRemoved: () => void;
}

export function MeetingChangeSheet({
  meeting,
  onClose,
  onRemoved,
}: MeetingChangeSheetProps): ReactElement {
  const t = useTranslation();
  const scheduled = meeting.status === "scheduled";
  const askRefund = !scheduled && meeting.balance_charge !== null;
  const [refund, setRefund] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);

  async function remove(): Promise<void> {
    if (busy || (askRefund && refund === null)) return;
    setBusy(true);
    setError(null);
    try {
      // spec:impl meeting-reschedule-cancel-delete#delete-scheduled-meeting-after-confirm
      const { response } = await apiClient(getSessionToken()).DELETE("/meetings/{meeting_id}", {
        params: {
          path: { meeting_id: meeting.id },
          query: { refund: askRefund ? (refund ?? undefined) : undefined },
        },
      });
      if (response.status === 204) onRemoved();
      else setError("extra.auth_request_failed");
    } catch {
      setError("extra.auth_network_error");
    } finally {
      setBusy(false);
    }
  }

  // spec:impl meeting-reschedule-cancel-delete#show-confirmation-4-4-title-text
  // spec:impl meeting-reschedule-cancel-delete#show-confirmation-4-5-title-text
  return (
    <Sheet
      title={t(scheduled ? "cancel.title" : "delete.title")}
      onClose={() => !busy && onClose()}
    >
      <div className="meeting-modal-actions">
        <p>{t(scheduled ? "cancel.text" : "delete.text")}</p>
        {/* spec:impl meeting-reschedule-cancel-delete#include-question-refund-q-yes-no-confirmation */}
        {/* spec:impl meeting-reschedule-cancel-delete#ask-refund-q-nothing-charged-client */}
        {askRefund && (
          <>
            <p>{t("delete.refund_q")}</p>
            <ChoiceChips
              label={t("delete.refund_q")}
              options={[
                { value: "yes", label: t("outcome.yes"), disabled: busy },
                { value: "no", label: t("outcome.no"), disabled: busy },
              ]}
              value={refund === null ? null : refund ? "yes" : "no"}
              onChange={(selection) => setRefund(selection === "yes")}
            />
          </>
        )}
        {error && (
          <p className="meeting-error" role="alert">
            {t(error)}
          </p>
        )}
        <button
          type="button"
          className="shell-destructive"
          disabled={busy || (askRefund && refund === null)}
          onClick={() => void remove()}
        >
          {t(scheduled ? "cancel.confirm" : "card.delete")}
        </button>
        {/* spec:impl meeting-reschedule-cancel-delete#close-confirmation-4-4-keep-meeting */}
        {/* spec:impl meeting-reschedule-cancel-delete#keep-meeting-untouched-confirmation-4-4 */}
        <button type="button" className="shell-secondary" disabled={busy} onClick={onClose}>
          {t("cancel.keep")}
        </button>
      </div>
    </Sheet>
  );
}
