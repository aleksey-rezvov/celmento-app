import type { ReactElement } from "react";
import { ContactButtons } from "@/components/ContactButtons";
import type { Schemas } from "@/lib/api/client";

interface SpecialistContactsProps {
  specialist: Schemas["SpecialistRef"];
  mainContact?: Schemas["MainContact"] | null;
  excludeMain?: boolean;
}

export function SpecialistContacts({
  specialist,
  mainContact,
  excludeMain = false,
}: SpecialistContactsProps): ReactElement {
  const omitted = excludeMain ? mainContact?.channel : null;
  return (
    <div className="booking-contact">
      <ContactButtons
        contacts={{
          phone: omitted === "phone" ? null : specialist.phone,
          telegram: omitted === "telegram" ? null : specialist.telegram,
          whatsapp: omitted === "whatsapp" ? null : specialist.whatsapp,
          email: omitted === "email" ? null : specialist.contact_email,
        }}
        preferred={mainContact?.channel ?? null}
      />
    </div>
  );
}
