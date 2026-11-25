"use client";

import type { ReactElement } from "react";
import { ChoiceChips } from "@/components/shell/ChoiceChips";
import { useTranslation } from "@/lib/i18n";
import type { ScheduleView } from "@/lib/schedule-view";

interface ViewSwitcherProps {
  value: ScheduleView;
  onChange: (view: ScheduleView) => void;
}

export function ViewSwitcher({ value, onChange }: ViewSwitcherProps): ReactElement {
  const t = useTranslation();

  return (
    <ChoiceChips
      value={value}
      label={t("meetings.title")}
      onChange={onChange}
      options={[
        { value: "schedule", label: t("meetings.view_schedule") },
        { value: "day", label: t("meetings.view_day") },
      ]}
    />
  );
}
