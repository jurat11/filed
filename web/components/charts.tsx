import { int, n, usd } from "@/lib/format";

/*
 * Charts drawn as plain SVG/HTML on the design tokens (globals.css). Marks are thin, the
 * grid is a recessive hairline, labels use text colors, and every chart has the same
 * numbers in a table or legend next to it, so no value is only in a tooltip.
 */

export type TrendPoint = { label: string; value: number | null; partial?: boolean };

/** A round axis top and 2 to 5 evenly spaced whole-number ticks. */
function niceScale(v: number): { max: number; ticks: number[] } {
  const raw = Math.max(v, 1) / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = Math.max(1, [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag);
  const max = Math.ceil(Math.max(v, 1) / step) * step;
  const ticks: number[] = [];
  for (let t = 0; t <= max + 1e-9; t += step) ticks.push(Math.round(t));
  return { max, ticks };
}

/** One count across fiscal years. A partial year is hollow and dashed; missing is a gap. */
export function TrendLine({ points, title }: { points: TrendPoint[]; title: string }) {
  const W = 640;
  const H = 220;
  const pad = { l: 48, r: 56, t: 16, b: 32 };
  const vals = points.map((p) => p.value).filter((v): v is number => v !== null);
  if (vals.length === 0) return null;
  const { max, ticks } = niceScale(Math.max(...vals, 1));
  const x = (i: number) => (points.length === 1 ? (pad.l + W - pad.r) / 2 : pad.l + (i * (W - pad.l - pad.r)) / (points.length - 1));
  const y = (v: number) => pad.t + (1 - v / max) * (H - pad.t - pad.b);
  const desc = points
    .map((p) => `${p.label}${p.partial ? " (partial year)" : ""}: ${p.value === null ? "missing" : int(p.value)}`)
    .join("; ");
  // The wash covers complete years only; a partial final year is drawn as a dashed line.
  const full = points.map((p, i) => ({ p, i })).filter(({ p }) => p.value !== null && !p.partial);
  const area =
    full.length > 1
      ? `M${x(full[0].i)},${y(0)} ` +
        full.map(({ p, i }) => `L${x(i)},${y(p.value!)}`).join(" ") +
        ` L${x(full[full.length - 1].i)},${y(0)} Z`
      : "";
  const lastIdx = points.map((p) => p.value !== null).lastIndexOf(true);

  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full max-w-3xl" role="img" aria-label={`${title}. ${desc}`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="var(--grid)" strokeWidth={1} />
            <text x={pad.l - 10} y={y(t) + 4} textAnchor="end" fontSize={12} fill="var(--muted)" className="num">
              {int(Math.round(t))}
            </text>
          </g>
        ))}
        {area && <path d={area} fill="var(--series)" opacity={0.1} />}
        {points.slice(1).map((p, i) => {
          const a = points[i];
          if (a.value === null || p.value === null) return null;
          return (
            <line
              key={p.label}
              x1={x(i)}
              y1={y(a.value)}
              x2={x(i + 1)}
              y2={y(p.value)}
              stroke="var(--series)"
              strokeWidth={2}
              strokeLinecap="round"
              strokeDasharray={p.partial ? "6 5" : undefined}
            />
          );
        })}
        {points.map((p, i) =>
          p.value === null ? null : (
            <g key={p.label}>
              <circle
                cx={x(i)}
                cy={y(p.value)}
                r={5}
                fill={p.partial ? "var(--surface)" : "var(--series)"}
                stroke={p.partial ? "var(--series)" : "var(--surface)"}
                strokeWidth={2}
              />
              {/* Larger invisible target for the hover title. */}
              <circle cx={x(i)} cy={y(p.value)} r={14} fill="transparent">
                <title>{`${p.label}${p.partial ? " (partial year)" : ""}: ${int(p.value)} certified LCAs`}</title>
              </circle>
            </g>
          ),
        )}
        {lastIdx >= 0 && (
          <text
            x={x(lastIdx) + 10}
            y={y(points[lastIdx].value!) + 4}
            fontSize={13}
            fontWeight={600}
            fill="var(--ink)"
          >
            {int(points[lastIdx].value)}
          </text>
        )}
        <line x1={pad.l} x2={W - pad.r} y1={y(0)} y2={y(0)} stroke="var(--line)" strokeWidth={1} />
        {points.map((p, i) => (
          <text key={p.label} x={x(i)} y={H - 8} textAnchor="middle" fontSize={12} fill="var(--muted)">
            {p.label}
            {p.partial ? "*" : ""}
          </text>
        ))}
      </svg>
      {points.some((p) => p.partial) && (
        <figcaption className="mt-1 text-xs text-muted">* partial fiscal year (latest DOL release so far)</figcaption>
      )}
    </figure>
  );
}

const LEVEL_COLORS = ["var(--lvl-1)", "var(--lvl-2)", "var(--lvl-3)", "var(--lvl-4)", "var(--lvl-none)"];

/** Wage level mix: one stacked bar on an ordered ramp (I light to IV dark), 2px gaps. */
export function LevelBar({ parts }: { parts: { label: string; value: number }[] }) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  if (!total) return <p className="text-sm text-muted">No certified LCAs in these years.</p>;
  return (
    <div>
      <div className="flex h-6 w-full gap-[2px] overflow-hidden rounded-md" role="img" aria-label={parts.map((p) => `${p.label} ${Math.round((100 * p.value) / total)}%`).join(", ")}>
        {parts.map((p, i) =>
          p.value ? (
            <div key={p.label} title={`${p.label}: ${int(p.value)}`} style={{ flexGrow: p.value, background: LEVEL_COLORS[i] }} />
          ) : null,
        )}
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {parts.map((p, i) => (
          <div key={p.label} className="rounded-lg bg-surface-2 px-3 py-2">
            <dt className="flex items-center gap-2 text-xs text-muted">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: LEVEL_COLORS[i] }} />
              {p.label}
            </dt>
            <dd className="mt-1 text-lg font-semibold">
              {Math.round((100 * p.value) / total)}%
              <span className="num ml-1.5 text-xs font-normal text-muted">{int(p.value)}</span>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** Ranked horizontal bars in one hue, with the value and share at the end. */
export function BarList({ items }: { items: { label: string; value: number }[] }) {
  const shown = items.filter((i) => i.value > 0).sort((a, b) => b.value - a.value);
  const total = shown.reduce((s, i) => s + i.value, 0);
  if (!total) return <p className="text-sm text-muted">No certified LCAs in these years.</p>;
  const max = shown[0].value;
  return (
    <ul className="space-y-3">
      {shown.map((i) => (
        <li key={i.label} className="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-3 text-sm sm:grid-cols-[12rem_1fr_7rem]">
          <span className="truncate text-ink-2">{i.label}</span>
          <span className="h-2.5 rounded-full bg-surface-2">
            <span className="block h-2.5 rounded-full bg-series" style={{ width: `${Math.max(2, (100 * i.value) / max)}%` }} />
          </span>
          <span className="num text-right">
            <span className="font-medium">{int(i.value)}</span>
            <span className="ml-1.5 text-muted">{Math.round((100 * i.value) / total)}%</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** 25th to 75th percentile range with the median marked, one row per year. */
export function WageRanges({
  rows,
}: {
  rows: { label: string; p25: unknown; median: unknown; p75: unknown; count: unknown; source: React.ReactNode }[];
}) {
  const hi = Math.max(...rows.map((r) => n(r.p75) ?? 0), 1);
  const lo = Math.min(...rows.map((r) => n(r.p25) ?? hi)) * 0.85;
  const pos = (v: unknown) => `${(100 * ((n(v) ?? lo) - lo)) / (hi - lo)}%`;
  return (
    <ul className="space-y-5">
      {rows.map((r) => (
        <li key={r.label} className="grid gap-2 sm:grid-cols-[4.5rem_1fr_15rem] sm:items-center sm:gap-4">
          <span className="text-sm font-medium">{r.label}</span>
          {n(r.count) ? (
            <div className="relative h-3 rounded-full bg-surface-2" aria-hidden>
              <div
                className="absolute h-3 rounded-full"
                style={{ left: pos(r.p25), width: `calc(${pos(r.p75)} - ${pos(r.p25)})`, background: "var(--lvl-1)" }}
              />
              <div className="absolute -top-1 h-5 w-1 rounded-full bg-series ring-2 ring-surface" style={{ left: `calc(${pos(r.median)} - 2px)` }} />
            </div>
          ) : (
            <span className="text-sm text-muted">No valid wages</span>
          )}
          <div className="text-sm">
            <span className="num">
              <span className="font-semibold">{usd(r.median)}</span>
              <span className="text-muted"> median · {usd(r.p25)} to {usd(r.p75)}</span>
            </span>
            <div className="mt-1">{r.source}</div>
          </div>
        </li>
      ))}
    </ul>
  );
}
