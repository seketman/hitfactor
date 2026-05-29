import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/seo/site-url";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    { url: absoluteUrl("/"), lastModified: now, changeFrequency: "monthly", priority: 1.0 },
    { url: absoluteUrl("/login"), lastModified: now, changeFrequency: "monthly", priority: 0.5 },
    { url: absoluteUrl("/signup"), lastModified: now, changeFrequency: "monthly", priority: 0.5 },
  ];
}
