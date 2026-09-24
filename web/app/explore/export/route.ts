import { explore, parseExplore } from "@/lib/queries";

export const dynamic = "force-dynamic";

const cell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function GET(req: Request) {
  const sp = Object.fromEntries(
    [...new URL(req.url).searchParams.keys()].map((k) => [k, new URL(req.url).searchParams.getAll(k)]),
  );
  const flat = Object.fromEntries(Object.entries(sp).map(([k, v]) => [k, v.length > 1 ? v : v[0]]));
  const rows = await explore(parseExplore(flat), 5000);
  const header = ["employer", "state", "certified_lcas", "mean_offered_wage", "wage_rows", "uscis_initial_approvals_fy2023", "h1b_dependent_latest", "url"];
  const body = rows.map((r) =>
    [r.display_name, r.state, r.certified, r.avg_wage, r.wage_rows, r.uscis_initial_total, r.h1b_dependent_latest, `/employer/${r.slug}`]
      .map(cell)
      .join(","),
  );
  return new Response([header.join(","), ...body].join("\n") + "\n", {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="filed-explore.csv"',
    },
  });
}
