import { useEffect, useRef, useState, type ReactElement } from "react";
import type { Schemas } from "@/lib/api/client";
import { useTranslation } from "@/lib/i18n";
import { LeaderAvatar } from "./LeaderAvatar";
import { leaderName, leaderSpecialties } from "./booking-display";

interface LeaderHeaderProps {
  firstName: string;
  lastName: string;
  photoUrl: string | null;
  specializations: readonly Schemas["Specialization"][];
  specializationOther: string | null;
  title?: string;
  heading?: "h1" | "h2";
}

export function LeaderHeader({
  firstName,
  lastName,
  photoUrl,
  specializations,
  specializationOther,
  title,
  heading: Heading = "h1",
}: LeaderHeaderProps): ReactElement {
  const t = useTranslation();
  const name = leaderName(firstName, lastName);
  const specialties = leaderSpecialties(specializations, specializationOther, t);

  return (
    <header className="booking-leader">
      <LeaderAvatar
        firstName={firstName}
        lastName={lastName}
        photoUrl={photoUrl}
        size={106}
        className="booking-avatar"
      />
      <Heading>{title ?? name}</Heading>
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
