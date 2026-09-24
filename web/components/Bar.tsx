import { n } from "@/lib/format";

const COLORS = ["var(--bar)", "var(--bar-2)", "var(--bar-3)", "var(--bar-4)", "var(--line)"];

/** A single stacked bar with a legend. Values are counts; shares are computed here. */
export function StackedBar({ parts }: { parts: { label: string; value: unknown }[] }) {
  const total = parts.reduce((s, p) => s + (n(p.value) ?? 0), 0);
  if (!total) return <p className="text-sm text-muted">No certified LCAs.</p>;
  return (
    <div>
      <div className="flex h-3 w-full overflow-hidden rounded bg-line">
        {parts.map((p, i) => {
          const v = n(p.value) ?? 0;
          return v ? (
            <div key={p.label} style={{ width: `${(100 * v) / total}%`, background: COLORS[i % 5] }} />
          ) : null;
        })}
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {parts.map((p, i) => !n(p.value) ? null : (
          <li key={p.label} className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: COLORS[i % 5] }} />
            {p.label} <span className="num text-muted">{Math.round((100 * (n(p.value) ?? 0)) / total)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
