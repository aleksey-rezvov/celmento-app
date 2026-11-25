"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent, type ReactElement } from "react";
import { apiClient, type Schemas } from "@/lib/api/client";
import { useTranslation, type MessageKey } from "@/lib/i18n";
import { folderPath, notesPath } from "@/lib/notes-navigation";
import { getSessionToken } from "@/lib/session";
import { NotesScreen } from "./NotesScreen";

type Folder = Schemas["Folder"];
type Color = Schemas["FolderColor"];

const palette = [
  { color: "blue", label: "extra.folder_color_blue" },
  { color: "green", label: "extra.folder_color_green" },
  { color: "peach", label: "extra.folder_color_peach" },
  { color: "pink", label: "extra.folder_color_pink" },
  { color: "lilac", label: "extra.folder_color_lilac" },
  { color: "yellow", label: "extra.folder_color_yellow" },
] as const satisfies readonly { color: Color; label: MessageKey }[];

export function FolderForm({ folder }: { folder?: Folder }): ReactElement {
  const router = useRouter();
  const t = useTranslation();
  const [name, setName] = useState(folder?.name ?? "");
  const [color, setColor] = useState<Color>(folder?.color ?? palette[0].color);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  const back = folder ? folderPath(folder.id) : notesPath;
  const valid = name.trim().length > 0 && name.trim().length <= 50;

  async function save(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!valid || saving) return;
    const token = getSessionToken();
    if (!token) return;
    setSaving(true);
    setError(null);
    try {
      const api = apiClient(token);
      const body: Schemas["FolderCreate"] = { name: name.trim(), color };
      const { data } = folder
        ? await api.PATCH("/folders/{folder_id}", {
            params: { path: { folder_id: folder.id } },
            body,
          })
        : await api.POST("/folders", { body });

      if (getSessionToken() !== token) return;
      if (data) router.replace(back);
      else setError("extra.auth_request_failed");
    } catch {
      if (getSessionToken() === token) setError("extra.auth_network_error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <NotesScreen title={folder?.name ?? t("notes.new_folder")} back={back}>
      <form className="notes-folder-form" onSubmit={(event) => void save(event)}>
        <fieldset className="notes-folder-fields" disabled={saving}>
          <label>
            <span>{t("notes.folder_name")}</span>
            <input
              type="text"
              required
              maxLength={50}
              value={name}
              onChange={(event) => setName(event.currentTarget.value)}
            />
          </label>
          <fieldset className="notes-folder-palette">
            <legend>{t("extra.folder_color")}</legend>
            <div className="notes-folder-colors">
              {palette.map((option) => (
                <button
                  className="notes-swatch"
                  key={option.color}
                  type="button"
                  data-folder-color={option.color}
                  aria-label={t(option.label)}
                  aria-pressed={color === option.color}
                  onClick={() => setColor(option.color)}
                >
                  {color === option.color && <span aria-hidden="true">✓</span>}
                </button>
              ))}
            </div>
          </fieldset>
        </fieldset>
        {error && (
          <p role="alert" className="notes-error">
            {t(error)}
          </p>
        )}
        <button className="shell-primary" type="submit" disabled={!valid || saving}>
          {t("extra.client_save")}
        </button>
      </form>
    </NotesScreen>
  );
}
