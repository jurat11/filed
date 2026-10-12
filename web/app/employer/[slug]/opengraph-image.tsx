import { int, n, sourceLabel, usd } from "@/lib/format";
import { OG_SIZE, type OgStat, renderCard } from "@/lib/og";
import { employer } from "@/lib/queries";

export const alt = "Employer H-1B LCA summary on Filed";
export const size = OG_SIZE;
export const contentType = "image/png";
export const revalidate = 86400;

/** Share card: the employer's latest-year numbers, with the file they come from. A figure
 * the data does not have is left out, never shown as 0. */
export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const d = await employer((await params).slug);
  const name = d?.e.display_name ?? "Employer not found";
  const last = d?.years.at(-1);
  const lastUscis = d?.uscis.at(-1);

  const stats: OgStat[] = [];
  if (last) {
    const fy = `FY${String(last.fiscal_year)}`;
    stats.push({ value: int(last.certified), label: `certified LCAs, ${fy}` });
    if (n(last.wage_median) !== null) stats.push({ value: usd(last.wage_median), label: `median offered pay, ${fy}` });
  }
  if (lastUscis && n(lastUscis.initial_approvals) !== null) {
    stats.push({
      value: int(lastUscis.initial_approvals),
      label: `USCIS initial approvals, FY${String(lastUscis.fiscal_year)}`,
    });
  }
  const source = last
    ? `Source: ${sourceLabel(String(last.source_file))}, ${int(last.filed)} ${n(last.filed) === 1 ? "row" : "rows"}`
    : d
      ? "USCIS Data Hub records only (no DOL LCA match)"
      : "Built from DOL and USCIS public records";

  return renderCard({
    eyebrow: "Employer H-1B filings",
    title: name,
    stats,
    source,
    stamp: last ? ["FILED", `DOL LCA FY${String(last.fiscal_year)}`] : undefined,
  });
}
