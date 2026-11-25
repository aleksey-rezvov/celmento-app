import type { ReactElement } from "react";
import { useTranslation, type MessageKey } from "@/lib/i18n";
import type { NoteFormat } from "@/lib/note-text";

const tools = [
  { format: "bulleted_list", label: "extra.note_bulleted_list", icon: "•≡" },
  { format: "numbered_list", label: "extra.note_numbered_list", icon: "1≡" },
  { format: "checklist", label: "extra.note_checklist", icon: "☑" },
  { format: "bold", label: "extra.note_bold", icon: "B" },
] as const satisfies readonly { format: NoteFormat; label: MessageKey; icon: string }[];

interface FormattingBarProps {
  onFormat: (format: NoteFormat) => void;
}

export function FormattingBar({ onFormat }: FormattingBarProps): ReactElement {
  const t = useTranslation();
  // spec:impl note-editor#show-formatting-bar-above-keyboard
  return (
    <div
      className="note-format"
      id="note-format"
      role="group"
      aria-label={t("extra.note_formatting")}
    >
      {tools.map(({ format, label, icon }) => (
        <button
          type="button"
          key={format}
          className="note-format-button"
          aria-label={t(label)}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onFormat(format)}
        >
          <span aria-hidden="true">{icon}</span>
        </button>
      ))}
    </div>
  );
}
