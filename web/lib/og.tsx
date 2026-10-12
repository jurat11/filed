/** Shared frame for the 1200x630 share cards (home and employer pages), so a link posted
 * anywhere looks like the site. Colors match the light theme tokens in globals.css. */
export const OG_SIZE = { width: 1200, height: 630 };

const ACCENT = "#256abf";
const INK = "#0f172a";
const MUTED = "#5b6474";
const LINE = "#d9dee6";

export type OgStat = { label: string; value: string };

export function OgCard({
  title,
  eyebrow,
  stats = [],
  source,
}: {
  title: string;
  eyebrow?: string;
  stats?: OgStat[];
  source: string;
}) {
  const long = title.length > 60;
  // Three stats with long labels need tighter type to stay inside the margins.
  const tight = stats.length > 2;
  const gap = tight ? 28 : 36;
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: "64px 72px",
        background: "#f5f6f8",
        color: INK,
        borderTop: `14px solid ${ACCENT}`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center" }}>
        <div
          style={{
            width: 52,
            height: 52,
            borderRadius: 14,
            background: ACCENT,
            color: "#fff",
            fontSize: 32,
            fontWeight: 700,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          F
        </div>
        <div style={{ marginLeft: 16, fontSize: 34, fontWeight: 700 }}>Filed</div>
        {eyebrow && (
          <div style={{ marginLeft: "auto", fontSize: 24, color: MUTED, letterSpacing: 1 }}>{eyebrow}</div>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ fontSize: long ? 56 : title.length > 36 ? 68 : 80, fontWeight: 700, lineHeight: 1.1 }}>
          {title}
        </div>
        {stats.length > 0 && (
          <div style={{ display: "flex", marginTop: 40 }}>
            {stats.map((s, i) => (
              <div
                key={s.label}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  paddingLeft: i === 0 ? 0 : gap,
                  marginLeft: i === 0 ? 0 : gap,
                  borderLeft: i === 0 ? "none" : `2px solid ${LINE}`,
                }}
              >
                <div style={{ fontSize: tight ? 48 : 56, fontWeight: 700, color: ACCENT }}>{s.value}</div>
                <div style={{ fontSize: tight ? 21 : 24, color: MUTED, marginTop: 4 }}>{s.label}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ display: "flex", fontSize: 24, color: MUTED }}>{source}</div>
    </div>
  );
}
