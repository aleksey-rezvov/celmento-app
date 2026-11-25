import { Fragment, type ReactElement, type ReactNode } from "react";
import { parseNoteText, type NoteLine } from "@/lib/note-text";

const linkSchemes = ["https:", "http:", "mailto:", "tel:", "zoommtg:", "msteams:"];

function inlineText(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const tokens =
    /\[([^\]\n]+)\]\(([^\s)]+)\)|\*\*([^*\n]+)\*\*|(?:https?:\/\/|mailto:|tel:|zoommtg:|msteams:)[^\s<>()]+/giu;
  let cursor = 0;
  for (const match of text.matchAll(tokens)) {
    const index = match.index;
    const literal = match[0];
    parts.push(text.slice(cursor, index));
    cursor = index + literal.length;
    if (match[3]) {
      parts.push(<strong key={index}>{match[3]}</strong>);
      continue;
    }
    const automatic = literal.replace(/[.,!?;:]+$/u, "");
    const value = match[2] ?? automatic;
    const url = URL.canParse(value) ? new URL(value) : null;
    // spec:impl note-editor#recognize-links-text-automatically-open
    parts.push(
      url && linkSchemes.includes(url.protocol) ? (
        <Fragment key={index}>
          <a href={url.href} target="_blank" rel="noreferrer">
            {match[1] ?? automatic}
          </a>
          {match[2] === undefined && literal.slice(automatic.length)}
        </Fragment>
      ) : (
        literal
      ),
    );
  }
  parts.push(text.slice(cursor));
  return parts;
}

interface ChecklistTextProps {
  text: string;
  personalTicks?: readonly number[];
  disabled?: boolean;
  onToggle?: (position: number) => void;
}

export function ChecklistText({
  text,
  personalTicks,
  disabled,
  onToggle,
}: ChecklistTextProps): ReactElement {
  const lines = parseNoteText(text);
  const blocks: ReactElement[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line) continue;
    if (line.kind === "heading") {
      const Heading = line.level === 1 ? "h2" : line.level === 2 ? "h3" : "h4";
      blocks.push(<Heading key={index}>{inlineText(line.text)}</Heading>);
      continue;
    }
    if (line.kind === "text") {
      blocks.push(<p key={index}>{line.text ? inlineText(line.text) : <br />}</p>);
      continue;
    }
    const start = index;
    const items: ReactElement[] = [];
    function row(item: NoteLine, key: number): ReactElement {
      if (item.kind !== "checklist")
        return (
          <li key={key} value={item.kind === "numbered" ? item.ordinal : undefined}>
            {inlineText(item.text)}
          </li>
        );
      const checked = personalTicks?.includes(item.position) ?? item.checked;
      return (
        <li key={key} className="note-check-item" data-checked={checked}>
          <label>
            <input
              type="checkbox"
              checked={checked}
              disabled={disabled || !onToggle}
              onChange={() => onToggle?.(item.position)}
            />
            <span>{inlineText(item.text)}</span>
          </label>
        </li>
      );
    }
    items.push(row(line, index));
    while (lines[index + 1]?.kind === line.kind) {
      index += 1;
      items.push(row(lines[index]!, index));
    }
    blocks.push(
      line.kind === "numbered" ? (
        <ol key={start}>{items}</ol>
      ) : (
        <ul className={line.kind === "checklist" ? "note-checklist" : undefined} key={start}>
          {items}
        </ul>
      ),
    );
  }
  return <div className="note-markdown">{blocks}</div>;
}
