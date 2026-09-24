import { search } from "@/lib/queries";

/** Typeahead suggestions for the search box. The form works without this. */
export async function GET(req: Request) {
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim().slice(0, 100);
  const hits = q.length >= 2 ? await search(q, 8) : [];
  return Response.json(
    hits.map((h) => ({
      slug: h.slug,
      name: h.display_name,
      state: h.state,
      alias: h.matched_alias,
      has_lca: h.has_lca,
      certified_total: h.certified_total,
    })),
    { headers: { "Cache-Control": "public, max-age=300" } },
  );
}
