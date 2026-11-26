import Image from "next/image";
import { useState, type ReactElement } from "react";
import "./leader-avatar.css";

interface LeaderAvatarProps {
  firstName: string;
  lastName: string;
  photoUrl: string | null;
  size: number;
  className?: string;
}

export function LeaderAvatar({
  firstName,
  lastName,
  photoUrl,
  size,
  className,
}: LeaderAvatarProps): ReactElement {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const initials = [firstName, lastName]
    .map((part) => Array.from(part.trim())[0] ?? "")
    .join("")
    .toUpperCase();

  return (
    <span
      className={className ? "leader-avatar " + className : "leader-avatar"}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {photoUrl && failedUrl !== photoUrl ? (
        <Image
          src={photoUrl}
          alt=""
          width={size}
          height={size}
          unoptimized
          onError={() => setFailedUrl(photoUrl)}
        />
      ) : (
        initials
      )}
    </span>
  );
}
