import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { int, usd } from "@/lib/format";
import {
  EXPORT_LIMIT,
  type ExploreParams,
  exploreQuery,
  PAGE_SIZE,
  STATES,
} from "@/lib/explore";
import { explore, LEVELS, lcaYears, parseExplore, ROLE_GROUPS, uscisYears } from "@/lib/queries";

export const metadata: Metadata = {
  title: "Explore",
  description:
    "Filter employers by role group, worksite state, wage level and fiscal year, using certified H-1B LCAs from DOL disclosure data.",
  alternates: { canonical: "/explore" },
};

type SP = Record<string, string | string[] | undefined>;

const href = (p: ExploreParams, patch: Partial<ExploreParams> = {}) => {
  const q = exploreQuery(p, { page: 1, ...patch });
  return q ? `/explore?${q}` : "/explore";
};

/** Active filters as removable chips. Each link is the current URL minus that filter. */
function chips(p: ExploreParams, fyLabel: (fy: string) => string) {
  const out: { label: string; href: string }[] = [];
  for (const r of p.role) out.push({ label: r, href: href(p, { role: p.role.filter((x) => x !== r) }) });
  for (const s of p.state) out.push({ label: s, href: href(p, { state: p.state.filter((x) => x !== s) }) });
  for (const l of p.level) out.push({ label: `Level ${l}`, href: href(p, { level: p.level.filter((x) => x !== l) }) });
  if (p.fy !== "all") out.push({ label: fyLabel(p.fy), href: href(p, { fy: "all" }) });
  if (p.min) out.push({ label: `At least ${int(p.min)} certified`, href: href(p, { min: 0 }) });
  if (p.hideDependent) out.push({ label: "H-1B dependent hidden", href: href(p, { hideDependent: false }) });
  return out;
}

export default async function Explore({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const [years, uYears] = await Promise.all([lcaYears(), uscisYears()]);
  const p = parseExplore(sp, years);
  const rows = await explore(p, PAGE_SIZE, (p.page - 1) * PAGE_SIZE);
  if (rows.length === 0 && p.page > 1) redirect(href(p));
  const total = rows[0]?.total_rows ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const uLabel = uYears.map((y) => `FY${y}`).join(", ");
  const latest = Math.max(...years);
  const fyLabel = (fy: string) => `FY${fy}${Number(fy) === latest ? " (Oct to Jun)" : ""}`;
  const active = chips(p, fyLabel);
  const box = "rounded-md border border-line bg-surface px-2 py-1.5";
  const first = total ? (p.page - 1) * PAGE_SIZE + 1 : 0;

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Explore employers</h1>
      <p className="mt-1 text-sm text-muted">
        Certified LCAs matching every filter, counted at the first worksite on each LCA.
      </p>

      <form
        action="/explore"
        aria-label="Filters"
        className="mt-6 grid gap-4 rounded-md border border-line bg-surface p-4 sm:grid-cols-2 lg:grid-cols-3"
      >
        <fieldset>
          <legend className="text-sm font-medium">Role group</legend>
          {ROLE_GROUPS.map((r) => (
            <label key={r} className="mt-1 flex items-center gap-2 text-sm">
              <input type="checkbox" name="role" value={r} defaultChecked={p.role.includes(r)} /> {r}
            </label>
          ))}
        </fieldset>
        <div className="space-y-3">
          <fieldset>
            <legend className="text-sm font-medium">Wage level</legend>
            <div className="mt-1 flex gap-3">
              {LEVELS.map((l) => (
                <label key={l} className="flex items-center gap-1 text-sm">
                  <input type="checkbox" name="level" value={l} defaultChecked={p.level.includes(l)} /> {l}
                </label>
              ))}
            </div>
          </fieldset>
          <details className={`${box} text-sm`} open={p.state.length > 0 || undefined}>
            <summary className="cursor-pointer font-medium">
              Worksite states{p.state.length ? ` (${p.state.join(", ")})` : ": all"}
            </summary>
            <fieldset className="mt-2 grid grid-cols-4 gap-x-2 gap-y-1 sm:grid-cols-5">
              <legend className="sr-only">Worksite states</legend>
              {STATES.map((s) => (
                <label key={s} className="flex items-center gap-1">
                  <input type="checkbox" name="state" value={s} defaultChecked={p.state.includes(s)} /> {s}
                </label>
              ))}
            </fieldset>
          </details>
          <label className="block text-sm font-medium">
            Fiscal year
            <select name="fy" defaultValue={p.fy} className={`${box} mt-1 block w-full font-normal`}>
              <option value="all">All loaded years</option>
              {years.map((y) => (
                <option key={y} value={String(y)}>
                  {fyLabel(String(y))}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="space-y-3">
          <label className="block text-sm font-medium">
            Minimum certified LCAs
            <input name="min" type="number" min={0} defaultValue={p.min || ""} className={`${box} mt-1 block w-full font-normal`} />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="hide_dependent" value="1" defaultChecked={p.hideDependent} />
            Hide H-1B dependent employers
          </label>
          {p.sort !== "certified" && <input type="hidden" name="sort" value={p.sort} />}
          <div className="flex flex-wrap gap-2">
            <button className="rounded-md bg-accent px-4 py-2 font-medium text-white dark:text-black">Apply</button>
            <a
              href={`/explore/export${exploreQuery(p, { page: 1 }) ? "?" + exploreQuery(p, { page: 1 }) : ""}`}
              className="rounded-md border border-line px-4 py-2"
            >
              Download CSV
            </a>
          </div>
        </div>
      </form>

      {active.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2 text-sm" aria-label="Active filters">
          {active.map((c) => (
            <Link
              key={c.label}
              href={c.href}
              className="rounded-full border border-line bg-surface px-3 py-1 hover:border-accent"
              aria-label={`Remove filter: ${c.label}`}
            >
              {c.label} <span aria-hidden="true">×</span>
            </Link>
          ))}
          <Link href={href(p, { role: [], state: [], level: [], fy: "all", min: 0, hideDependent: false })} className="text-muted underline">
            Clear all
          </Link>
        </div>
      )}

      <p className="mt-4 text-sm text-muted" aria-live="polite">
        {total ? `Employers ${int(first)} to ${int(first + rows.length - 1)} of ${int(total)}` : ""}
      </p>

      <div className="mt-2 overflow-x-auto">
        <table className="num w-full min-w-[640px] text-sm">
          <caption className="sr-only">Employers matching the filters, sorted by {p.sort}</caption>
          <thead className="text-left text-muted">
            <tr className="border-b border-line">
              {[
                ["name", "Employer"],
                ["certified", "Certified LCAs"],
                ["wage", "Mean offered wage"],
                ["uscis", `USCIS initial approvals, ${uLabel}`],
              ].map(([k, label]) => (
                <th
                  key={k}
                  scope="col"
                  aria-sort={p.sort === k ? (k === "name" ? "ascending" : "descending") : undefined}
                  className={`py-2 font-normal ${k === "name" ? "" : "text-right"}`}
                >
                  <Link href={href(p, { sort: k })} className={p.sort === k ? "text-ink underline" : "hover:text-ink"}>
                    {label}
                  </Link>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.slug} className="border-b border-line">
                <td className="py-2">
                  <Link href={`/employer/${r.slug}`} className="hover:underline">{r.display_name}</Link>
                  <span className="ml-2 text-xs text-muted">{r.state}</span>
                  {r.h1b_dependent_latest && <span className="ml-2 text-xs text-muted">dependent</span>}
                </td>
                <td className="text-right">{int(r.certified)}</td>
                <td className="text-right">{usd(r.avg_wage)}</td>
                <td className="text-right">{int(r.uscis_initial_total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p className="mt-4 text-muted">No employers match these filters.</p>}
      </div>

      {pages > 1 && (
        <nav aria-label="Pages" className="mt-4 flex items-center gap-3 text-sm">
          {p.page > 1 ? (
            <Link href={href(p, { page: p.page - 1 })} rel="prev" className="underline">
              Previous
            </Link>
          ) : (
            <span className="text-muted">Previous</span>
          )}
          <span>
            Page {p.page} of {int(pages)}
          </span>
          {p.page < pages ? (
            <Link href={href(p, { page: p.page + 1 })} rel="next" className="underline">
              Next
            </Link>
          ) : (
            <span className="text-muted">Next</span>
          )}
        </nav>
      )}
      {total > EXPORT_LIMIT && (
        <p className="mt-2 text-xs text-muted">
          The CSV holds the first {int(EXPORT_LIMIT)} employers in this order. Narrow the filters to
          export the rest.
        </p>
      )}
      <p className="mt-4 text-xs text-muted">
        Source: DOL LCA disclosure files, certified cases only; a dash in the USCIS column means no
        USCIS {uLabel} record matched the employer; mean wage over certified full-time
        LCAs with a valid annual wage. <Link href="/sources" className="underline">Sources</Link>
      </p>
    </div>
  );
}
