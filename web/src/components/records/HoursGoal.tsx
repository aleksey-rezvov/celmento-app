"use client";

import { useEffect, useRef, useState, type ReactElement } from "react";
import { ConfirmSheet } from "@/components/shell/ConfirmSheet";
import { Sheet } from "@/components/shell/Sheet";
import { useAccount } from "@/lib/account";
import { apiClient, type Schemas } from "@/lib/api/client";
import { useLanguage, useTranslation, type MessageKey } from "@/lib/i18n";
import { RecordsLoadState } from "./RecordsScreen";
import { useRecordsHoursGoal } from "./records-data";
import { formatRecordsHours } from "./records-display";

type Log = Schemas["RecordsHoursLogType"];
type Goal = Schemas["RecordsHoursGoal"];
type GoalResult = Schemas["RecordsHoursGoalResult"];

interface GoalEditorProps {
  type: Log;
  goal: Goal | null;
  onClose: () => void;
  onSaved: (value: GoalResult) => void;
}

function GoalEditor({ type, goal, onClose, onSaved }: GoalEditorProps): ReactElement {
  const t = useTranslation();
  const { currentSessionToken } = useAccount();
  const [hours, setHours] = useState(goal?.hours ?? "");
  const [label, setLabel] = useState(goal?.label ?? "");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  const pending = useRef<AbortController | null>(null);
  const normalizedHours = hours.trim().replace(",", ".");
  const normalizedLabel = label.trim();
  const valid =
    /^[0-9]{1,5}(?:\.[0-9]{1,2})?$/u.test(normalizedHours) &&
    Number(normalizedHours) > 0 &&
    normalizedLabel.length > 0 &&
    [...normalizedLabel].length <= 120;

  useEffect(() => () => pending.current?.abort(), []);

  // spec:impl records-hours-goal#open-edit-delete
  async function persist(next: Goal | null): Promise<void> {
    const token = currentSessionToken();
    if (!token || pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    const active = (): boolean => !controller.signal.aborted && currentSessionToken() === token;
    const options = {
      params: { query: { type } },
      signal: controller.signal,
    };
    setBusy(true);
    setError(null);
    try {
      const api = apiClient(token);
      const result = next
        ? await api.PUT("/records/hours/goal", { ...options, body: next })
        : await api.DELETE("/records/hours/goal", options);
      if (!active()) return;
      if (result.response.ok && (!next || result.data)) {
        onSaved(result.data ?? { goal: null });
      } else setError("extra.auth_request_failed");
    } catch {
      if (active()) setError("extra.auth_network_error");
    } finally {
      pending.current = null;
      if (active()) setBusy(false);
    }
  }

  if (confirming) {
    return (
      <ConfirmSheet
        title={t("card.delete")}
        text={t("extra.records_goal_delete_effect")}
        confirmLabel={t("card.delete")}
        destructive
        pending={busy}
        error={error ? t(error) : null}
        onClose={() => {
          setConfirming(false);
          setError(null);
        }}
        onConfirm={() => void persist(null)}
      />
    );
  }

  return (
    <Sheet title={t(goal ? "card.edit" : "goal.set")} onClose={onClose} closeDisabled={busy}>
      <form
        className="records-goal-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (valid) void persist({ hours: normalizedHours, label: normalizedLabel });
        }}
      >
        <label className="auth-field">
          <span>{t("goal.hours")}</span>
          <input
            required
            inputMode="decimal"
            value={hours}
            disabled={busy}
            onChange={(event) => setHours(event.currentTarget.value)}
          />
        </label>
        <label className="auth-field">
          <span>{t("goal.label")}</span>
          <input
            required
            value={label}
            disabled={busy}
            placeholder={t("goal.label_hint")}
            onChange={(event) => setLabel(event.currentTarget.value)}
          />
        </label>
        {error && (
          <p role="alert" className="auth-error">
            {t(error)}
          </p>
        )}
        <button className="shell-primary" type="submit" disabled={!valid || busy}>
          {t("form.save")}
        </button>
        {goal && (
          <button
            className="shell-destructive"
            type="button"
            disabled={busy}
            onClick={() => setConfirming(true)}
          >
            {t("card.delete")}
          </button>
        )}
      </form>
    </Sheet>
  );
}

interface HoursGoalProps {
  type: Log;
  totalHours: number;
}

export function HoursGoal({ type, totalHours }: HoursGoalProps): ReactElement {
  const t = useTranslation();
  const language = useLanguage();
  const { data, error, retry } = useRecordsHoursGoal(type);
  const [edited, setEdited] = useState<GoalResult | null>(null);
  const [editing, setEditing] = useState(false);
  const current = edited ?? data;
  if (!current) return <RecordsLoadState error={error} retry={retry} />;

  const goal = current.goal;
  const target = goal ? Number(goal.hours) : 0;
  const remaining = Math.max(0, Math.round(target * 100) - Math.round(totalHours * 100)) / 100;
  const progress = t("goal.progress", {
    H: formatRecordsHours(totalHours, language),
    [language === "ru" ? "цель" : "goal"]: formatRecordsHours(target, language),
  });

  return (
    <div className="records-hours-goal">
      {goal && (
        <>
          <h2>{goal.label}</h2>
          {/* spec:impl records-hours-goal#show-goal-progress */}
          <progress aria-label={progress} max={target} value={Math.min(totalHours, target)} />
          <p>{progress}</p>
          <p>{t("goal.left", { H: formatRecordsHours(remaining, language) })}</p>
          {remaining === 0 && <p>{t("goal.reached")}</p>}
        </>
      )}
      {/* spec:impl records-hours-goal#open-edit-delete */}
      <button className="shell-secondary" type="button" onClick={() => setEditing(true)}>
        {t(goal ? "card.edit" : "goal.set")}
      </button>
      {editing && (
        <GoalEditor
          type={type}
          goal={goal}
          onClose={() => setEditing(false)}
          onSaved={(value) => {
            setEdited(value);
            setEditing(false);
          }}
        />
      )}
    </div>
  );
}
