import type { Schemas } from "@/lib/api/client";
import type { MessageKey } from "@/lib/i18n";

export const bookingFormatLabels = {
  online: "profile.format_online",
  in_person: "profile.format_offline",
  both: "profile.format_both",
} as const satisfies Record<Schemas["SessionFormat"], MessageKey>;
