import { int } from "@/lib/format";

export type TrendPoint = { label: string; value: number | null; partial?: boolean };

/**
 * Line chart of one count across fiscal years. A partial year (a release that does not
 * cover the full fiscal year) is drawn hollow with a dashed segment. Missing values are
 * gaps, not zeros. The values are also in the table next to the chart.
 */
export function TrendLine({ points, title }: { points: TrendPoint[]; title: string }) {
  const W = 560;
  const H = 150;
  const pad = { l: 40, r: 40, t: 24, b: 28 };
  const vals = points.map((p) => p.value).filter((v): v is number => v !== null);
  if (vals.length === 0) return null;
  const max = Math.max(...vals, 1);
  const x = (i: number) =>
    points.length === 1 ? W / 2 : pad.l + (i * (W - pad.l - pad.r)) / (points.length - 1);
  const y = (v: number) => pad.t + (1 - v / max) * (H - pad.t - pad.b);
  const desc = points
    .map((p) => `${p.label}${p.partial ? " (partial year)" : ""}: ${p.value === null ? "missing" : int(p.value)}`)
    .join("; ");

  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full max-w-xl" role="img" aria-label={`${title}. ${desc}`}>
        <line x1={pad.l} x2={W - pad.r} y1={H - pad.b} y2={H - pad.b} stroke="var(--line)" />
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
              stroke="var(--bar)"
              strokeWidth={2}
              strokeDasharray={p.partial ? "5 4" : undefined}
            />
          );
        })}
        {points.map((p, i) =>
          p.value === null ? null : (
            <g key={p.label}>
              <circle
                cx={x(i)}
                cy={y(p.value)}
                r={4}
                fill={p.partial ? "var(--surface)" : "var(--bar)"}
                stroke="var(--bar)"
                strokeWidth={2}
              />
              <text x={x(i)} y={y(p.value) - 9} textAnchor="middle" fontSize={12} fill="var(--ink)" className="num">
                {int(p.value)}
              </text>
            </g>
          ),
        )}
        {points.map((p, i) => (
          <text key={p.label} x={x(i)} y={H - 8} textAnchor="middle" fontSize={12} fill="var(--muted)">
            {p.label}
            {p.partial ? "*" : ""}
          </text>
        ))}
      </svg>
      {points.some((p) => p.partial) && (
        <figcaption className="mt-1 text-xs text-muted">* partial fiscal year (latest DOL release)</figcaption>
      )}
    </figure>
  );
}
