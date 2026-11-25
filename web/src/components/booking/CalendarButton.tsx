import { useEffect, useRef, useState, type ReactElement } from "react";
import { useTranslation, type MessageKey } from "@/lib/i18n";

interface CalendarButtonProps {
  label: "done.add_calendar" | "meet.add_calendar";
  load: (signal: AbortSignal) => Promise<{ data?: Blob; response: Response }>;
  onMissing?: () => void;
}

export function CalendarButton({ label, load, onMissing }: CalendarButtonProps): ReactElement {
  const t = useTranslation();
  const pending = useRef<AbortController | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);

  useEffect(() => () => pending.current?.abort(), []);

  async function download(): Promise<void> {
    if (pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setDownloading(true);
    setError(null);
    try {
      const { data, response } = await load(controller.signal);
      if (controller.signal.aborted) return;
      if (!data) {
        if (onMissing && (response.status === 404 || response.status === 422)) onMissing();
        else setError("extra.auth_request_failed");
        return;
      }

      const url = URL.createObjectURL(data);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "celmento-session.ics";
      document.body.append(anchor);
      try {
        anchor.click();
      } finally {
        anchor.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch {
      if (!controller.signal.aborted) setError("extra.auth_network_error");
    } finally {
      pending.current = null;
      if (!controller.signal.aborted) setDownloading(false);
    }
  }

  return (
    <>
      <button
        className="auth-secondary"
        type="button"
        disabled={downloading}
        onClick={() => void download()}
      >
        {t(label)}
      </button>
      {error && (
        <p className="auth-error" role="alert">
          {t(error)}
        </p>
      )}
    </>
  );
}
