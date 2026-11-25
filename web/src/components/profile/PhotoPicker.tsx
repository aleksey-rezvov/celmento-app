"use client";

import Image from "next/image";
import { useEffect, useState, type ReactElement } from "react";
import { apiClient, type Schemas } from "@/lib/api/client";
import { useTranslation } from "@/lib/i18n";
import { getSessionToken } from "@/lib/session";
import { ProfileError } from "./ProfileScreen";

const imageTypes = "image/jpeg,image/png,image/webp";

export interface PendingPhoto {
  blob: Blob;
  preview: string;
}

interface PhotoPickerProps {
  existing: string | null;
  pending: PendingPhoto | null | undefined;
  onChange?: (photo: PendingPhoto | null) => void;
  busy: boolean;
  onBusyChange: (busy: boolean) => void;
  firstName: string;
  lastName: string;
}

async function cropPhoto(file: File): Promise<Blob> {
  if (file.type && !imageTypes.split(",").includes(file.type)) {
    throw new Error("Unsupported photo format.");
  }
  const bitmap = await createImageBitmap(file);
  const dimension = 512;

  try {
    const canvas = document.createElement("canvas");
    canvas.width = dimension;
    canvas.height = dimension;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Photo canvas is unavailable.");

    const side = Math.min(bitmap.width, bitmap.height);
    const left = (bitmap.width - side) / 2;
    const top = (bitmap.height - side) / 2;
    context.beginPath();
    context.arc(dimension / 2, dimension / 2, dimension / 2, 0, 2 * Math.PI);
    context.clip();
    context.drawImage(bitmap, left, top, side, side, 0, 0, dimension, dimension);

    return await new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("No image was produced."))),
        "image/png",
      );
    });
  } finally {
    bitmap.close();
  }
}

export async function saveProfilePhoto(photo: PendingPhoto | null): Promise<Schemas["Account"]> {
  const api = apiClient(getSessionToken());
  const result = photo
    ? await api.PUT("/account/photo", {
        body: { file: "profile.png" },
        bodySerializer: ({ file }) => {
          const form = new FormData();
          form.set("file", photo.blob, file);
          return form;
        },
      })
    : await api.DELETE("/account/photo");
  if (!result.data) throw new Error("The account photo was not updated.");

  return result.data;
}

export function PhotoPicker({
  existing,
  pending,
  onChange,
  busy,
  onBusyChange,
  firstName,
  lastName,
}: PhotoPickerProps): ReactElement {
  const t = useTranslation();
  const [failed, setFailed] = useState(false);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const preview = pending?.preview;
  const source = pending === undefined ? existing : (preview ?? null);
  const initials = [firstName, lastName].map((part) => Array.from(part.trim())[0]).join("");

  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  async function choose(file: File | undefined): Promise<void> {
    if (!file || !onChange) return;

    onBusyChange(true);
    setFailed(false);
    try {
      const blob = await cropPhoto(file);
      onChange({ blob, preview: URL.createObjectURL(blob) });
    } catch {
      setFailed(true);
    } finally {
      onBusyChange(false);
    }
  }

  return (
    <div className="profile-photo">
      <div className="profile-avatar">
        {/* spec:impl account-profile#let-account-add-photo-gallery */}
        {source && source !== unavailable ? (
          <Image
            src={source}
            width={120}
            height={120}
            alt=""
            unoptimized
            onError={() => setUnavailable(source)}
          />
        ) : (
          <span aria-hidden="true">{initials}</span>
        )}
      </div>
      {onChange && (
        <div className="profile-photo-options">
          <label className="profile-secondary profile-file-label">
            {t("extra.profile_edit_photo")}
            <input
              type="file"
              accept={imageTypes}
              disabled={busy}
              onChange={(event) => {
                void choose(event.currentTarget.files?.[0]);
                event.currentTarget.value = "";
              }}
            />
          </label>
          <label className="profile-secondary profile-file-label">
            {t("extra.profile_camera")}
            <input
              type="file"
              accept={imageTypes}
              capture="user"
              disabled={busy}
              onChange={(event) => {
                void choose(event.currentTarget.files?.[0]);
                event.currentTarget.value = "";
              }}
            />
          </label>
          {(source || existing) && (
            <button
              type="button"
              className="profile-danger"
              disabled={busy}
              onClick={() => {
                setFailed(false);
                onChange(null);
              }}
            >
              {t("extra.profile_remove_photo")}
            </button>
          )}
        </div>
      )}
      {onChange && failed && <ProfileError message="extra.profile_photo_invalid" />}
    </div>
  );
}
