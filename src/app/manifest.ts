import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "HitFactor",
    short_name: "HitFactor",
    description: "Tu historial de tiro deportivo, en un solo lugar.",
    start_url: "/",
    display: "standalone",
    background_color: "#fafaf9",
    theme_color: "#d97706",
    icons: [
      { src: "/icon.svg", type: "image/svg+xml", sizes: "any" },
      { src: "/apple-icon", type: "image/png", sizes: "180x180" },
    ],
  };
}
