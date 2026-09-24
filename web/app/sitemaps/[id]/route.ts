import { employerSlugs, groupSlugs, meta } from "@/lib/queries";
import { SITE_URL, xmlEscape } from "@/lib/site";

export const revalidate = 86400;

const PAGES = ["/", "/explore", "/sources"];

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let paths: string[];
  if (id === "pages") paths = [...PAGES, ...(await groupSlugs()).map((g) => `/group/${g.group_slug}`)];
  else if (/^\d{1,4}$/.test(id)) paths = (await employerSlugs(Number(id))).map((r) => `/employer/${r.slug}`);
  else return new Response("Not found", { status: 404 });
  if (paths.length === 0) return new Response("Not found", { status: 404 });
  const lastmod = (await meta()).loaded_at?.slice(0, 10);
  const body =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    paths
      .map((p) => `  <url><loc>${xmlEscape(SITE_URL + p)}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ""}</url>\n`)
      .join("") +
    "</urlset>\n";
  return new Response(body, { headers: { "Content-Type": "application/xml" } });
}
