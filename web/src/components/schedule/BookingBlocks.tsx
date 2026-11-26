"use client";

import { useEffect, useRef, useState, type ReactElement } from "react";
import { ConfirmSheet } from "@/components/shell/ConfirmSheet";
import { Sheet } from "@/components/shell/Sheet";
import { useAccount } from "@/lib/account";
import { apiClient, type Schemas } from "@/lib/api/client";
import { formatDate } from "@/lib/format";
import { useLanguage, useTranslation, type MessageKey } from "@/lib/i18n";
import { zonedDay, zonedInstant } from "@/lib/zoned-date";
import { minuteOfDay } from "./schedule-data";

type Block = Schemas["BookingTimeBlock"];
type BlockInput = Schemas["BookingTimeBlockCreate"];
export type BookingBlocksUpdate = (blocks: readonly Block[]) => Block[];

const minutesInDay = 24 * 60;

interface BlockDayProps {
  blocks: readonly Block[];
  day: string;
  timeZone: string;
}

interface DayPosition {
  id: string;
  start: number;
  end: number;
  allDay: boolean;
}

function positionsOnDay({ blocks, day, timeZone }: BlockDayProps): DayPosition[] {
  return blocks
    .flatMap((block) => {
      const firstDay = zonedDay(block.starts_at, timeZone);
      const lastDay = zonedDay(block.ends_at, timeZone);
      if (firstDay > day || lastDay < day) return [];
      const start = firstDay < day ? 0 : minuteOfDay(block.starts_at, timeZone);
      const end = lastDay > day ? minutesInDay : minuteOfDay(block.ends_at, timeZone);
      const allDay =
        lastDay > day &&
        (firstDay < day || zonedDay(new Date(Date.parse(block.starts_at) - 1), timeZone) !== day);
      return start < end ? [{ id: block.id, start, end, allDay }] : [];
    })
    .sort((first, second) => first.start - second.start || first.end - second.end);
}

function clock(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

export function BookingBlockShading(props: BlockDayProps): ReactElement {
  return (
    <>
      {positionsOnDay(props).map(({ id, start, end }) => (
        <div
          key={id}
          className="schedule-booking-block"
          aria-hidden="true"
          style={{ top: `${start / 14.4}%`, height: `${(end - start) / 14.4}%` }}
        />
      ))}
    </>
  );
}

interface CloseBookingSheetProps {
  day: string;
  timeZone: string;
  busy: boolean;
  error: MessageKey | null;
  onClose: () => void;
  onSave: (values: BlockInput) => void;
}

function CloseBookingSheet({
  day,
  timeZone,
  busy,
  error,
  onClose,
  onSave,
}: CloseBookingSheetProps): ReactElement {
  const t = useTranslation();
  const language = useLanguage();
  const [allDay, setAllDay] = useState(false);
  const [start, setStart] = useState("10:00");
  const [end, setEnd] = useState("11:00");
  const valid =
    allDay ||
    (start < end &&
      zonedInstant(day, start, timeZone) !== null &&
      zonedInstant(day, end, timeZone) !== null);
  const issue = !valid ? "extra.schedule_block_invalid" : error;

  return (
    <Sheet title={t("extra.schedule_close_booking")} onClose={onClose} closeDisabled={busy}>
      <form
        className="schedule-closure-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (valid) onSave(allDay ? { date: day } : { date: day, start, end });
        }}
      >
        <time dateTime={day}>{formatDate(day, "UTC", language, { year: "numeric" })}</time>
        <label className="schedule-closure-all-day">
          <input
            type="checkbox"
            checked={allDay}
            disabled={busy}
            onChange={(event) => setAllDay(event.currentTarget.checked)}
          />
          {t("extra.schedule_all_day")}
        </label>
        {!allDay && (
          <div className="schedule-closure-times">
            <label className="auth-field">
              <span>{t("extra.profile_work_start")}</span>
              <input
                type="time"
                required
                value={start}
                disabled={busy}
                onChange={(event) => setStart(event.currentTarget.value)}
              />
            </label>
            <label className="auth-field">
              <span>{t("extra.profile_work_end")}</span>
              <input
                type="time"
                required
                value={end}
                disabled={busy}
                onChange={(event) => setEnd(event.currentTarget.value)}
              />
            </label>
          </div>
        )}
        {issue && (
          <p className="auth-error" role="alert">
            {t(issue)}
          </p>
        )}
        <button className="shell-primary" type="submit" disabled={!valid || busy}>
          {t("form.save")}
        </button>
      </form>
    </Sheet>
  );
}

interface BookingBlocksProps extends BlockDayProps {
  onChange: (update: BookingBlocksUpdate) => void;
}

type BookingAction = { kind: "close" } | { kind: "reopen"; id: string };
type BookingChange = { kind: "close"; values: BlockInput } | { kind: "reopen"; id: string };

export function BookingBlocks({ onChange, ...dayProps }: BookingBlocksProps): ReactElement {
  const { day, timeZone } = dayProps;
  const t = useTranslation();
  const { currentSessionToken } = useAccount();
  const [action, setAction] = useState<BookingAction | null>(null);
  const [error, setError] = useState<MessageKey | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef<AbortController | null>(null);
  const positions = positionsOnDay(dayProps);
  const reopen = t("extra.schedule_reopen_booking");

  useEffect(() => () => pending.current?.abort(), []);

  function open(next: BookingAction | null): void {
    setError(null);
    setAction(next);
  }

  // spec:impl booking-time-blocks#manage-blocks-from-day
  async function save(change: BookingChange): Promise<void> {
    const token = currentSessionToken();
    if (!token || pending.current) return;
    const controller = new AbortController();
    const { signal } = controller;
    const current = (): boolean => !signal.aborted && currentSessionToken() === token;
    pending.current = controller;
    setBusy(true);
    setError(null);

    try {
      const api = apiClient(token);
      if (change.kind === "close") {
        const { data, response } = await api.POST("/meetings/booking-blocks", {
          body: change.values,
          signal,
        });
        if (!current()) return;
        if (!data) {
          setError(
            response.status === 422 ? "extra.schedule_block_invalid" : "extra.auth_request_failed",
          );
          return;
        }
        onChange((previous) => [...previous.filter(({ id }) => id !== data.id), data]);
      } else {
        const { response } = await api.DELETE("/meetings/booking-blocks/{booking_block_id}", {
          params: { path: { booking_block_id: change.id } },
          signal,
        });
        if (!current()) return;
        if (!response.ok && response.status !== 404) {
          setError("extra.auth_request_failed");
          return;
        }
        onChange((previous) => previous.filter(({ id }) => id !== change.id));
      }
      setAction(null);
    } catch {
      if (current()) setError("extra.auth_network_error");
    } finally {
      pending.current = null;
      if (current()) setBusy(false);
    }
  }

  return (
    <div className="schedule-booking-controls">
      <button className="shell-secondary" type="button" onClick={() => open({ kind: "close" })}>
        {t("extra.schedule_close_booking")}
      </button>
      {positions.length > 0 && (
        <ul className="schedule-closure-list" aria-label={t("extra.schedule_booking_closed")}>
          {positions.map(({ id, start, end, allDay }) => {
            const interval = allDay ? t("extra.schedule_all_day") : `${clock(start)}–${clock(end)}`;
            return (
              <li key={id}>
                <div>
                  <span>{t("extra.schedule_booking_closed")}</span>
                  <strong>{interval}</strong>
                </div>
                <button
                  className="shell-secondary"
                  type="button"
                  aria-label={`${reopen} · ${interval}`}
                  onClick={() => open({ kind: "reopen", id })}
                >
                  {reopen}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {action?.kind === "close" && (
        <CloseBookingSheet
          day={day}
          timeZone={timeZone}
          busy={busy}
          error={error}
          onSave={(values) => void save({ kind: "close", values })}
          onClose={() => open(null)}
        />
      )}
      {action?.kind === "reopen" && (
        <ConfirmSheet
          title={reopen}
          text={t("extra.schedule_reopen_booking_effect")}
          confirmLabel={reopen}
          destructive={false}
          pending={busy}
          error={error ? t(error) : null}
          onConfirm={() => void save(action)}
          onClose={() => open(null)}
        />
      )}
    </div>
  );
}
