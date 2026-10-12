import { ImageResponse } from "next/og";
import { compact } from "@/lib/format";
import { OG_SIZE, OgCard, type OgStat } from "@/lib/og";
import { siteStats } from "@/lib/queries";

export const alt = "Filed: which employers file H-1B paperwork, and at what pay";
export const size = OG_SIZE;
export const contentType = "image/png";
export const revalidate = 86400;

/** Default share card for the home page and every page without its own (Explore, Guide,
 * Sources). The numbers are the live site totals; if the database is unreachable the card
 * still renders, just without them. */
export default async function Image() {
  let stats: OgStat[] = [];
  let source = "Built only from U.S. Department of Labor and USCIS public records";
  try {
    const s = await siteStats();
    if (s.filed > 0) {
      stats = [
        { value: compact(s.filed), label: "LCAs filed" },
        { value: compact(s.employers), label: "employers" },
      ];
      if (s.latestYear) source = `DOL LCA disclosure data through FY${s.latestYear} · USCIS Employer Data Hub`;
    }
  } catch {
    // Render the card without numbers rather than failing the share preview.
  }
  return new ImageResponse(
    (
      <OgCard
        eyebrow="H-1B filings, from public records"
        title="Which employers file H-1B paperwork for entry-level roles, and at what pay"
        stats={stats}
        source={source}
      />
    ),
    size,
  );
}
