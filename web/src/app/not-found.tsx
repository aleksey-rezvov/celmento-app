"use client";

import type { ReactElement } from "react";
import { DeviceScreen } from "@/components/auth/DeviceScreen";
import { PublicNotFound } from "@/components/booking/BookingScreen";
import "@/components/booking/booking.css";

export default function NotFound(): ReactElement {
  // spec:impl interface-language#show-public-pages-not-found-page
  // spec:impl character-illustrations#show-character-files-browser-pages
  return (
    <DeviceScreen>
      <PublicNotFound />
    </DeviceScreen>
  );
}
