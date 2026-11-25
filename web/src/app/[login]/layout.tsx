import type { ReactElement, ReactNode } from "react";
import { DeviceScreen } from "@/components/auth/DeviceScreen";
import { BookingSessionProvider } from "@/components/booking/BookingSession";
import "@/components/booking/booking.css";

export default function PublicLayout({ children }: { children: ReactNode }): ReactElement {
  // spec:impl interface-language#show-public-pages-not-found-page
  return (
    <DeviceScreen>
      <BookingSessionProvider>{children}</BookingSessionProvider>
    </DeviceScreen>
  );
}
