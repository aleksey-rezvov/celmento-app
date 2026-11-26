import { specializationKeys } from "@/components/profile/profile-edit";
import type { Schemas } from "@/lib/api/client";
import type { MessageKey } from "@/lib/i18n";
import type { Translate } from "@/lib/i18n/messages";

export const bookingFormatLabels = {
  online: "profile.format_online",
  in_person: "profile.format_offline",
  both: "profile.format_both",
} as const satisfies Record<Schemas["SessionFormat"], MessageKey>;

export function leaderName(firstName: string, lastName: string): string {
  return [firstName, lastName].filter(Boolean).join(" ");
}

export function leaderSpecialties(
  specializations: readonly Schemas["Specialization"][],
  other: string | null,
  t: Translate,
): string {
  return specializations
    .map((specialization) =>
      specialization === "other" && other ? other : t(specializationKeys[specialization]),
    )
    .join(" · ");
}
