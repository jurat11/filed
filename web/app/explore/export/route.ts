import { EXPORT_LIMIT, toCsv } from "@/lib/explore";
import { explore, lcaYears, parseExplore, uscisYears } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const sp: Record<string, string[]> = {};
  for (const k of new Set(params.keys())) sp[k] = params.getAll(k);
  const [years, uYears] = await Promise.all([lcaYears(), uscisYears()]);
  const rows = await explore(parseExplore(sp, years), EXPORT_LIMIT);
  return new Response(toCsv(rows, uYears), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="filed-explore.csv"',
    },
  });
}
