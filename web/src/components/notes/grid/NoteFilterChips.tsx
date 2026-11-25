import type { ReactElement } from "react";
import { ChoiceChips } from "@/components/shell/ChoiceChips";
import type { Schemas } from "@/lib/api/client";
import { useTranslation } from "@/lib/i18n";

type Filter = Schemas["NoteFilter"];

export function NoteFilterChips({
  value,
  onChange,
}: {
  value: Filter;
  onChange: (filter: Filter) => void;
}): ReactElement {
  const t = useTranslation();

  return (
    <ChoiceChips
      label={t("notes.title")}
      value={value}
      onChange={onChange}
      options={[
        { value: "all", label: t("notes.all") },
        { value: "mine", label: t("notes.mine") },
        { value: "shared", label: t("notes.shared_with_me") },
      ]}
    />
  );
}
