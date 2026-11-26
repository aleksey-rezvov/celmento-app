import type { MetadataRoute } from "next";

// spec:impl mobile-app-shell#installable-phone-home-screen
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/app",
    name: "celmēnto",
    short_name: "celmēnto",
    start_url: "/app",
    scope: "/",
    display: "standalone",
    background_color: "#f5ece5",
    theme_color: "#f5ece5",
    icons: [
      { src: "/icon.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/celmento-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
