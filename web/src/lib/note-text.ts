import type { Schemas } from "@/lib/api/client";

type NoteText = Pick<Schemas["Note"], "title" | "text">;

export type NoteLine =
  | { kind: "text" | "bullet"; text: string }
  | { kind: "heading"; text: string; level: 1 | 2 | 3 }
  | { kind: "numbered"; text: string; ordinal: number }
  | { kind: "checklist"; text: string; position: number; checked: boolean };

// Match the API's checklist position calculation.
const checklist = /^([ \t]*-[ \t]+\[)([ xX])(\][ \t]+)(.*?)(\r?)$/su;

export function noteTitle(note: NoteText): string {
  // spec:impl note-editor#use-first-line-text-note
  return note.title || (note.text.split(/\r?\n/u, 1)[0] ?? "");
}

export function parseNoteText(text: string): NoteLine[] {
  let position = 0;
  return text.split(/\r?\n/u).map((line): NoteLine => {
    const item = checklist.exec(line);
    if (item) {
      return {
        kind: "checklist",
        text: item[4] ?? "",
        position: position++,
        checked: item[2] !== " ",
      };
    }
    const heading = /^(#{1,3})[ \t]+(.+)$/u.exec(line);
    if (heading) {
      const level = heading[1]?.length === 1 ? 1 : heading[1]?.length === 2 ? 2 : 3;
      return { kind: "heading", text: heading[2] ?? "", level };
    }
    const bullet = /^[ \t]*[-*+][ \t]+(.*)$/u.exec(line);
    if (bullet) return { kind: "bullet", text: bullet[1] ?? "" };
    const numbered = /^[ \t]*(\d{1,9})\.[ \t]+(.*)$/u.exec(line);
    if (numbered)
      return { kind: "numbered", text: numbered[2] ?? "", ordinal: Number(numbered[1]) };
    return { kind: "text", text: line };
  });
}

export function toggleAuthorItem(text: string, position: number): string {
  let index = 0;
  return text
    .split(/(\r?\n)/u)
    .map((line, segment) => {
      if (segment % 2) return line;
      const item = checklist.exec(line);
      if (!item || index++ !== position) return line;
      return item[1] + (item[2] === " " ? "x" : " ") + item[3] + item[4] + item[5];
    })
    .join("");
}

export function toShareText(note: NoteText): string {
  const text = note.text
    .split(/\r?\n/u)
    .map((line) => {
      const item = checklist.exec(line);
      return item ? (item[2] === " " ? "☐ " : "☑ ") + item[4] : line;
    })
    .join("\n");
  return [note.title, text].filter(Boolean).join("\n\n");
}

export function singleNoteLine(value: string): string {
  return value.replace(/[\r\n\u2028\u2029]+/gu, " ");
}

export type NoteFormat = "bulleted_list" | "numbered_list" | "checklist" | "bold";

export function formatNoteSelection(
  text: string,
  start: number,
  end: number,
  format: NoteFormat,
): { text: string; start: number; end: number } {
  if (format === "bold") {
    if (text.slice(start - 2, start) === "**" && text.slice(end, end + 2) === "**") {
      return {
        text: text.slice(0, start - 2) + text.slice(start, end) + text.slice(end + 2),
        start: start - 2,
        end: end - 2,
      };
    }
    return {
      text: text.slice(0, start) + "**" + text.slice(start, end) + "**" + text.slice(end),
      start: start + 2,
      end: end + 2,
    };
  }

  const from = start === 0 ? 0 : text.lastIndexOf("\n", start - 1) + 1;
  const nextLine = text.indexOf("\n", end > start && text[end - 1] === "\n" ? end - 1 : end);
  const until = nextLine === -1 ? text.length : nextLine;
  const prefix = (line: number): string =>
    format === "checklist" ? "- [ ] " : format === "numbered_list" ? String(line + 1) + ". " : "- ";
  const lines = text.slice(from, until).split("\n");
  const formatted = lines
    .map((line, index) =>
      format === "checklist" && checklist.test(line)
        ? line
        : prefix(index) + line.replace(/^[ \t]*(?:-[ \t]+\[[ xX]\]|[-*+]|\d+\.)[ \t]+/u, ""),
    )
    .join("\n");
  const firstContent = from + prefix(0).length;
  const cursor = Math.min(
    from + formatted.length,
    Math.max(firstContent, start + formatted.length - (until - from)),
  );
  return {
    text: text.slice(0, from) + formatted + text.slice(until),
    start: start === end ? cursor : firstContent,
    end: start === end ? cursor : from + formatted.length,
  };
}

export function limitNoteText(value: string, limit: number): string {
  return Array.from(value).slice(0, limit).join("");
}
