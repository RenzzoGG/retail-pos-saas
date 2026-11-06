import type { MetadataRoute } from "next";
import { getSiteUrl } from "@/lib/site-url";

/** Public pages can be indexed; the private app, APIs and one-time links can't. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/app", "/api", "/auth", "/invite", "/onboarding"] },
    sitemap: `${getSiteUrl()}/sitemap.xml`,
  };
}
