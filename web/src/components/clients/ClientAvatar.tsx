"use client";

import Image from "next/image";
import { useEffect, useState, type ReactElement } from "react";
import { apiClient } from "@/lib/api/client";
import { getSessionToken } from "@/lib/session";

interface LoadedPhoto {
  clientId: string;
  version: string;
  url: string;
}

export function useClientPhoto(clientId: string, photoUrl: string | null): string | null {
  const [photo, setPhoto] = useState<LoadedPhoto | null>(null);

  useEffect(() => {
    const token = getSessionToken();
    if (!token || !photoUrl) return;

    const controller = new AbortController();
    let url: string | null = null;
    async function load(session: string, version: string): Promise<void> {
      try {
        const { data } = await apiClient(session).GET("/clients/{client_id}/photo", {
          params: { path: { client_id: clientId } },
          parseAs: "blob",
          cache: "no-store",
          signal: controller.signal,
        });
        if (!data || controller.signal.aborted || getSessionToken() !== session) return;

        url = URL.createObjectURL(data);
        setPhoto({ clientId, version, url });
      } catch {
        // An unavailable image leaves the client's initials visible.
      }
    }

    void load(token, photoUrl);
    return () => {
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [clientId, photoUrl]);

  return photo?.clientId === clientId && photo.version === photoUrl ? photo.url : null;
}

interface ClientAvatarProps {
  clientId: string;
  name: string;
  photoUrl: string | null;
  size?: number;
}

export function ClientAvatar({
  clientId,
  name,
  photoUrl,
  size = 48,
}: ClientAvatarProps): ReactElement {
  const url = useClientPhoto(clientId, photoUrl);
  const initials = name
    .trim()
    .split(/\s+/u, 2)
    .map((part) => Array.from(part)[0] ?? "")
    .join("")
    .toUpperCase();

  return (
    <span
      className="inline-grid shrink-0 place-items-center overflow-hidden rounded-full bg-[#e6f0fe] font-semibold text-[#173d70]"
      style={{ width: size, height: size, fontSize: size * 0.3 }}
      aria-hidden="true"
    >
      {url ? (
        <Image
          src={url}
          alt=""
          width={size}
          height={size}
          className="size-full object-cover"
          unoptimized
        />
      ) : (
        initials
      )}
    </span>
  );
}
