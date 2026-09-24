import { employerCount, SITEMAP_CHUNK } from "@/lib/queries";
import { SITE_URL } from "@/lib/site";

export const revalidate = 86400;

/** Sitemap index: the fixed pages plus one sitemap per 40,000 employer pages. */
export async function GET() {
  const chunks = Math.max(1, Math.ceil((await employerCount()) / SITEMAP_CHUNK));
  const maps = ["pages", ...Array.from({ length: chunks }, (_, i) => String(i))];
  const body =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    maps.map((m) => `  <sitemap><loc>${SITE_URL}/sitemaps/${m}</loc></sitemap>\n`).join("") +
    "</sitemapindex>\n";
  return new Response(body, { headers: { "Content-Type": "application/xml" } });
}
