import Image from "next/image";
import { useEffect, useRef, useState, type ReactElement } from "react";
import { specializationKeys } from "@/components/profile/profile-edit";
import type { Schemas } from "@/lib/api/client";
import { useTranslation } from "@/lib/i18n";

interface LeaderHeaderProps {
  firstName: string;
  lastName: string;
  photoUrl: string | null;
  specializations: readonly Schemas["Specialization"][];
  specializationOther: string | null;
  title?: string;
}

export function LeaderHeader({
  firstName,
  lastName,
  photoUrl,
  specializations,
  specializationOther,
  title,
}: LeaderHeaderProps): ReactElement {
  const t = useTranslation();
  const [photoFailed, setPhotoFailed] = useState(false);
  const name = [firstName, lastName].filter(Boolean).join(" ");
  const initials = [firstName, lastName]
    .map((part) => Array.from(part.trim())[0] ?? "")
    .join("")
    .toUpperCase();
  const specialties = specializations
    .map((specialization) =>
      specialization === "other" && specializationOther
        ? specializationOther
        : t(specializationKeys[specialization]),
    )
    .join(" · ");

  return (
    <header className="booking-leader">
      <div className="booking-avatar" aria-hidden="true">
        {photoUrl && !photoFailed ? (
          <Image
            src={photoUrl}
            alt=""
            width={106}
            height={106}
            unoptimized
            onError={() => setPhotoFailed(true)}
          />
        ) : (
          initials
        )}
      </div>
      <h1>{title ?? name}</h1>
      {specialties && <p>{specialties}</p>}
    </header>
  );
}

export function LeaderAbout({ text }: { text: string }): ReactElement | null {
  const t = useTranslation();
  const content = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflow, setOverflow] = useState(text.split(/\r?\n/u).length > 3);

  useEffect(() => {
    const element = content.current;
    if (!element || expanded) return;
    const measure = (): void => setOverflow(element.scrollHeight > element.clientHeight + 1);
    const frame = window.requestAnimationFrame(measure);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(element);
    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [expanded, text]);

  if (!text.trim()) return null;
  return (
    <div className="booking-about">
      <p ref={content} data-expanded={expanded}>
        {text}
      </p>
      {overflow && !expanded && (
        <button className="auth-text-link" type="button" onClick={() => setExpanded(true)}>
          {t("public.more")}
        </button>
      )}
    </div>
  );
}
