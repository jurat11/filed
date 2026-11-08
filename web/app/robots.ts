import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  return {
    // Explore filter combinations and home-page searches are endless, uncached URLs: each crawl
    // runs a function and a query (docs/decisions.md D37). Plain /explore stays crawlable.
    rules: { userAgent: "*", allow: "/", disallow: ["/api/", "/explore/export", "/explore?", "/?"] },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
