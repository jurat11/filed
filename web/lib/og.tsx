import { ImageResponse } from "next/og";
import { LOGO_BARS, LOGO_FOLD, LOGO_PAGE, LOGO_VIEWBOX } from "./logo";
import { ogFont } from "./ogFont";

/** Shared frame for the 1200x630 share cards (home and employer pages), so a link posted
 * anywhere looks like the site. Colors match the light theme tokens in globals.css. */
export const OG_SIZE = { width: 1200, height: 630 };

const ACCENT = "#1b3a6b";
const INK = "#1a1814";
const PAPER = "#f4efe3";
const MUTED = "#5f5647";
const LINE = "#b9b09a";
const STAMP = "#9b2c1c";

/** The Filed mark on its accent badge, for share cards and icons (fixed colors, since these
 * render outside the page's theme). `radius` is the badge corner in px; 0 gives a full-bleed
 * square for icons the OS rounds itself. */
export function OgMark({ size, radius, fill = 0.78 }: { size: number; radius: number; fill?: number }) {
  const glyph = Math.round(size * fill);
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        background: ACCENT,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <svg width={glyph} height={glyph} viewBox={LOGO_VIEWBOX}>
        <path d={LOGO_PAGE} fill={PAPER} stroke={PAPER} strokeWidth={1.5} strokeLinejoin="round" />
        <path d={LOGO_FOLD} fill={ACCENT} fillOpacity={0.35} />
        {LOGO_BARS.map((d) => (
          <path key={d} d={d} fill={ACCENT} />
        ))}
      </svg>
    </div>
  );
}

export type OgStat = { label: string; value: string };

type CardProps = {
  title: string;
  eyebrow?: string;
  stats?: OgStat[];
  source: string;
  /** Lines inside the rubber stamp; the first is the big word. Omit for no stamp. */
  stamp?: string[];
  /** A large stamp in the right margin (home) instead of a compact one in the masthead. */
  bigStamp?: boolean;
};

function Stamp({ lines, big }: { lines: string[]; big: boolean }) {
  const word = big ? 52 : 28;
  const line = big ? 17 : 13;
  return (
    <div
      style={{
        display: "flex",
        transform: `rotate(${big ? -6 : -4}deg)`,
        border: `${big ? 3 : 2}px solid ${STAMP}`,
        padding: big ? 5 : 3,
        color: STAMP,
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          border: `${big ? 2 : 1}px solid ${STAMP}`,
          padding: big ? "12px 24px 10px" : "6px 14px 5px",
        }}
      >
        <div style={{ display: "flex", fontSize: word, fontWeight: 600, letterSpacing: big ? 10 : 6, paddingLeft: big ? 10 : 6 }}>{lines[0]}</div>
        {lines.slice(1).map((l) => (
          <div key={l} style={{ display: "flex", fontSize: line, letterSpacing: 1.5, textTransform: "uppercase", marginTop: 3 }}>
            {l}
          </div>
        ))}
      </div>
    </div>
  );
}

function Card({ title, eyebrow, stats = [], source, stamp, bigStamp = false, family }: CardProps & { family?: string }) {
  const tight = stats.length > 2;
  const gap = tight ? 28 : 40;
  const side = !!stamp && bigStamp;
  const width = 1056;
  const size = side ? 62 : title.length > 60 ? 54 : title.length > 36 ? 66 : 80;
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        padding: "52px 72px 56px",
        background: PAPER,
        color: INK,
        fontFamily: family,
        position: "relative",
      }}
    >
      <div style={{ display: "flex", alignItems: "center" }}>
        <OgMark size={52} radius={4} />
        <div style={{ marginLeft: 16, fontSize: 40, fontWeight: 600 }}>Filed</div>
        {eyebrow && (
          <div style={{ marginLeft: "auto", fontSize: 22, color: MUTED, letterSpacing: 3, textTransform: "uppercase" }}>
            {eyebrow}
          </div>
        )}
        {stamp && !bigStamp && (
          <div style={{ display: "flex", marginLeft: 36, marginTop: 4, marginBottom: 4 }}>
            <Stamp lines={stamp} big={false} />
          </div>
        )}
      </div>
      <div style={{ display: "flex", flexDirection: "column", marginTop: 22 }}>
        <div style={{ height: 4, background: INK }} />
        <div style={{ height: 1, background: INK, marginTop: 3 }} />
      </div>

      <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, justifyContent: "center", paddingTop: 8 }}>
        <div style={{ display: "flex", maxWidth: width, fontSize: size, fontWeight: 600, lineHeight: 1.08, letterSpacing: -1 }}>
          {title}
        </div>
        {stats.length > 0 && (
          <div style={{ display: "flex", marginTop: 34 }}>
            {stats.map((s, i) => (
              <div
                key={s.label}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  paddingLeft: i === 0 ? 0 : gap,
                  marginLeft: i === 0 ? 0 : gap,
                  borderLeft: i === 0 ? "none" : `1px solid ${LINE}`,
                }}
              >
                <div style={{ fontSize: tight ? 50 : 58, fontWeight: 600, color: ACCENT, lineHeight: 1 }}>{s.value}</div>
                <div style={{ fontSize: tight ? 22 : 25, color: MUTED, marginTop: 8 }}>{s.label}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ display: "flex", fontSize: 24, color: MUTED, borderTop: `1px solid ${LINE}`, paddingTop: 16 }}>{source}</div>

      {side && stamp && (
        <div style={{ position: "absolute", right: 84, top: 382, display: "flex" }}>
          <Stamp lines={stamp} big />
        </div>
      )}
    </div>
  );
}

/** A 1200x630 share card. The serif is fetched for just the glyphs the card uses; if that
 * fails the card still renders, in the default font. */
export async function renderCard(props: CardProps): Promise<ImageResponse> {
  const text = ["Filed", props.title, props.eyebrow ?? "", props.source, ...(props.stamp ?? []), ...(props.stats ?? []).flatMap((s) => [s.value, s.label])].join(" ");
  const [bold, regular] = await Promise.all([ogFont(text, 600), ogFont(text, 400)]);
  const fonts = [bold, regular].filter((f): f is NonNullable<typeof f> => !!f);
  return new ImageResponse(<Card {...props} family={fonts.length === 2 ? "Newsreader" : undefined} />, {
    ...OG_SIZE,
    fonts: fonts.length === 2 ? fonts : undefined,
  });
}
