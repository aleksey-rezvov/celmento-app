import type { Schemas } from "./api/client";

export type Contour = Schemas["Contour"];

export function currentContour(): Contour {
  return process.env.NEXT_PUBLIC_CLM_APP_CONTOUR === "ru" ? "ru" : "world";
}

export function otherContour(): Contour {
  return currentContour() === "ru" ? "world" : "ru";
}

export function contourDomain(contour: Contour): string {
  return contour === "ru" ? "celmento.ru" : "celmento.com";
}

export function contourWebOrigin(contour: Contour): string {
  if (contour === currentContour() && typeof window !== "undefined") {
    return window.location.origin;
  }

  return (
    (contour === otherContour() && process.env.NEXT_PUBLIC_CLM_APP_OTHER_ZONE_URL) ||
    "https://" + contourDomain(contour)
  );
}
