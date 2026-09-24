import { ImageResponse } from "next/og";
import { int, sourceLabel } from "@/lib/format";
import { employer } from "@/lib/queries";

export const alt = "Employer H-1B LCA summary on Filed";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const revalidate = 86400;

/** Share card: the employer's latest-year certified LCAs, with the file it comes from. */
export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const d = await employer((await params).slug);
  const name = d?.e.display_name ?? "Employer not found";
  const last = d?.years.at(-1);
  const line = last
    ? `${int(last.certified)} certified H-1B LCAs in FY${String(last.fiscal_year)}`
    : d
      ? "USCIS Data Hub records only (no DOL LCA match)"
      : "";
  const source = last ? `Source: ${sourceLabel(String(last.source_file))}, ${int(last.filed)} rows` : "";
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 72,
          background: "#fbfaf7",
          color: "#1c1b19",
        }}
      >
        <div style={{ fontSize: 34, color: "#1f5f8b", fontWeight: 700 }}>Filed</div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: name.length > 40 ? 56 : 72, fontWeight: 700, lineHeight: 1.1 }}>{name}</div>
          <div style={{ fontSize: 40, marginTop: 24 }}>{line}</div>
        </div>
        <div style={{ fontSize: 24, color: "#6b675f" }}>
          {source || "Built from DOL and USCIS public records"}
        </div>
      </div>
    ),
    size,
  );
}
