import type { ReactElement } from "react";
import { ContactButtons } from "@/components/ContactButtons";
import type { Schemas } from "@/lib/api/client";

export function MainContactButton({
  contact,
}: {
  contact: Schemas["MainContact"] | null;
}): ReactElement | null {
  if (!contact || contact.channel === "other") return null;
  const { channel, value } = contact;

  // spec:impl public-booking-page#show-leader-main-contact-channel
  return (
    <div className="booking-contact">
      <ContactButtons
        contacts={{
          phone: channel === "phone" ? value : null,
          telegram: channel === "telegram" ? value : null,
          whatsapp: channel === "whatsapp" ? value : null,
          email: channel === "email" ? value : null,
        }}
        preferred={channel}
      />
    </div>
  );
}
