import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/seo/site-url";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/login", "/signup"],
        disallow: [
          "/dashboard",
          "/matches",
          "/firearms",
          "/ammo",
          "/activity",
          "/import",
          "/about",
          "/auth/",
          "/q/",
        ],
      },
    ],
    sitemap: absoluteUrl("/sitemap.xml"),
  };
}
