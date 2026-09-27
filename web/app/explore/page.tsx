import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Scroll } from "@/components/Scroll";
import { buttonClass, Icon, PageHeader } from "@/components/ui";
import { int, quarterEnd, usd } from "@/lib/format";
import {
  EXPORT_LIMIT,
  type ExploreParams,
  exploreQuery,
  PAGE_SIZE,
  STATES,
} from "@/lib/explore";
import { explore, LEVELS, lcaYears, parseExplore, ROLE_GROUPS, siteStats, uscisYears } from "@/lib/queries";

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
  if (p.hideCapExempt) out.push({ label: "Likely cap-exempt hidden", href: href(p, { hideCapExempt: false }) });
  return out;
}

export default async function Explore({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const [years, uYears, stats] = await Promise.all([lcaYears(), uscisYears(), siteStats()]);
  const p = parseExplore(sp, years);
  const rows = await explore(p, PAGE_SIZE, (p.page - 1) * PAGE_SIZE);
  if (rows.length === 0 && p.page > 1) redirect(href(p));
  const total = rows[0]?.total_rows ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const uLabel = uYears.map((y) => `FY${y}`).join(", ");
  const latest = Math.max(...years);
  const partialTo =
    stats.latestYear === latest && stats.latestQuarter && stats.latestQuarter < 4
      ? quarterEnd(latest, stats.latestQuarter).replace(/ \d+,/, "")
      : null;
  const fyLabel = (fy: string) => `FY${fy}${Number(fy) === latest && partialTo ? ` (through ${partialTo})` : ""}`;
  const active = chips(p, fyLabel);
  const field = "mt-1.5 block h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm font-normal outline-none focus:border-accent focus:ring-4 focus:ring-accent-soft";
  const check = "h-4 w-4 rounded accent-[var(--accent)]";
  const first = total ? (p.page - 1) * PAGE_SIZE + 1 : 0;
  const exportQs = exploreQuery(p, { page: 1 });
  const legend = "text-xs font-semibold uppercase tracking-wide text-muted";

  return (
    <div>
      <PageHeader eyebrow="Explore" title="Find employers by role, place and wage level">
        Pick filters on the left. The table counts certified LCAs that match every filter, at the first
        worksite on each LCA, and links to each employer&rsquo;s page.
      </PageHeader>

      <div className="grid gap-6 lg:grid-cols-[17rem_minmax(0,1fr)] lg:items-start">
        <form action="/explore" aria-label="Filters" className="card space-y-6 p-5 lg:sticky lg:top-24">
          <div className="flex items-center gap-2 font-semibold">
            <Icon name="filter" className="h-4 w-4 text-accent" /> Filters
          </div>
          <fieldset>
            <legend className={legend}>Role group</legend>
            <div className="mt-2 space-y-1.5">
              {ROLE_GROUPS.map((r) => (
                <label key={r} className="flex items-center gap-2.5 text-sm">
                  <input type="checkbox" name="role" value={r} defaultChecked={p.role.includes(r)} className={check} /> {r}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className={legend}>Wage level</legend>
            <div className="mt-2 grid grid-cols-4 gap-2">
              {LEVELS.map((l) => (
                <label key={l} className="flex cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-line py-1.5 text-sm has-[:checked]:border-accent has-[:checked]:bg-accent-soft has-[:checked]:text-accent has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent">
                  <input type="checkbox" name="level" value={l} defaultChecked={p.level.includes(l)} className="sr-only" /> {l}
                </label>
              ))}
            </div>
            <p className="mt-1.5 text-xs text-muted">Level I is entry level.</p>
          </fieldset>
          <details className="rounded-lg border border-line text-sm" open={p.state.length > 0 || undefined}>
            <summary className="flex cursor-pointer items-center justify-between px-3 py-2 font-medium">
              Worksite states{p.state.length ? ` (${p.state.join(", ")})` : ": all"}
              <span aria-hidden className="text-muted">▾</span>
            </summary>
            <fieldset className="grid max-h-56 grid-cols-4 gap-x-2 gap-y-1.5 overflow-y-auto border-t border-line px-3 py-2">
              <legend className="sr-only">Worksite states</legend>
              {STATES.map((s) => (
                <label key={s} className="flex items-center gap-1.5">
                  <input type="checkbox" name="state" value={s} defaultChecked={p.state.includes(s)} className={check} /> {s}
                </label>
              ))}
            </fieldset>
          </details>
          <label className={`block ${legend}`}>
            Fiscal year
            <select name="fy" defaultValue={p.fy} className={field}>
              <option value="all">All loaded years</option>
              {years.map((y) => (
                <option key={y} value={String(y)}>
                  {fyLabel(String(y))}
                </option>
              ))}
            </select>
          </label>
          <label className={`block ${legend}`}>
            Minimum certified LCAs
            <input name="min" type="number" min={0} inputMode="numeric" placeholder="0" defaultValue={p.min || ""} className={field} />
          </label>
          <div className="space-y-2">
            <label className="flex items-center gap-2.5 text-sm">
              <input type="checkbox" name="hide_dependent" value="1" defaultChecked={p.hideDependent} className={check} />
              Hide H-1B dependent employers
            </label>
            <label className="flex items-center gap-2.5 text-sm">
              <input type="checkbox" name="hide_cap_exempt" value="1" defaultChecked={p.hideCapExempt} className={check} />
              Hide likely cap-exempt employers
            </label>
          </div>
          {p.sort !== "certified" && <input type="hidden" name="sort" value={p.sort} />}
          <div className="flex gap-2">
            <button className={`${buttonClass} flex-1`}>Apply</button>
            <Link href="/explore" className="inline-flex items-center rounded-lg border border-line px-3 text-sm text-muted hover:text-ink">
              Reset
            </Link>
          </div>
        </form>

        <div className="min-w-0 space-y-4">
          {active.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 text-sm" aria-label="Active filters">
              {active.map((c) => (
                <Link
                  key={c.label}
                  href={c.href}
                  className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-3 py-1 font-medium text-accent transition hover:bg-accent hover:text-accent-ink"
                  aria-label={`Remove filter: ${c.label}`}
                >
                  {c.label} <span aria-hidden="true">×</span>
                </Link>
              ))}
              <Link
                href={href(p, { role: [], state: [], level: [], fy: "all", min: 0, hideDependent: false, hideCapExempt: false })}
                className="px-1 text-muted underline hover:text-ink"
              >
                Clear all
              </Link>
            </div>
          )}

          <div className="card overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
              <p className="text-sm text-muted" aria-live="polite">
                {total ? `Employers ${int(first)} to ${int(first + rows.length - 1)} of ${int(total)}` : ""}
              </p>
              <a
                href={`/explore/export${exportQs ? "?" + exportQs : ""}`}
                className="inline-flex items-center gap-2 rounded-lg border border-line px-3 py-1.5 text-sm font-medium transition hover:border-accent hover:text-accent"
              >
                <Icon name="download" className="h-4 w-4" />
                Download CSV
              </a>
            </div>
            <Scroll label="Employers">
              <table className="data-table num w-full min-w-[640px] text-sm">
                <caption className="sr-only">Employers matching the filters, sorted by {p.sort}</caption>
                <thead className="text-left">
                  <tr>
                    {[
                      ["name", "Employer"],
                      ["certified", "Certified LCAs"],
                      ["wage", "Mean offered wage"],
                      ["uscis", "USCIS initial approvals"],
                    ].map(([k, label]) => (
                      <th
                        key={k}
                        scope="col"
                        aria-sort={p.sort === k ? (k === "name" ? "ascending" : "descending") : undefined}
                        className={k === "name" ? "" : "text-right"}
                      >
                        <Link
                          href={href(p, { sort: k })}
                          className={`inline-flex items-center gap-1 ${p.sort === k ? "text-accent" : "hover:text-ink"}`}
                        >
                          {label}
                          <span aria-hidden>{p.sort === k ? (k === "name" ? "↑" : "↓") : ""}</span>
                        </Link>
                        {k === "uscis" && uLabel && (
                          <span className="block text-[10px] font-normal normal-case tracking-normal">{uLabel}</span>
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.slug}>
                      <td className="min-w-[16rem]">
                        <Link href={`/employer/${r.slug}`} className="font-medium hover:text-accent hover:underline">{r.display_name}</Link>
                        <span className="ml-2 text-xs text-muted">{r.state}</span>
                        {r.h1b_dependent_latest && <span className="ml-2 rounded bg-surface-2 px-1.5 py-0.5 text-xs text-muted">dependent</span>}
                        {r.cap_exempt_rule && <span className="ml-2 rounded bg-accent-soft px-1.5 py-0.5 text-xs text-accent">likely cap-exempt</span>}
                      </td>
                      <td className="text-right font-medium">{int(r.certified)}</td>
                      <td className="text-right">{usd(r.avg_wage)}</td>
                      <td className="text-right">{int(r.uscis_initial_total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length === 0 && <p className="px-5 py-8 text-center text-muted">No employers match these filters.</p>}
            </Scroll>
          </div>

          {pages > 1 && (
            <nav aria-label="Pages" className="flex items-center justify-between gap-3 text-sm">
              {p.page > 1 ? (
                <Link href={href(p, { page: p.page - 1 })} rel="prev" className="rounded-lg border border-line bg-surface px-3 py-1.5 font-medium hover:border-accent hover:text-accent">
                  Previous
                </Link>
              ) : (
                <span aria-disabled="true" className="cursor-not-allowed rounded-lg border border-dashed border-line px-3 py-1.5 text-muted">Previous</span>
              )}
              <span className="text-muted">
                Page {p.page} of {int(pages)}
              </span>
              {p.page < pages ? (
                <Link href={href(p, { page: p.page + 1 })} rel="next" className="rounded-lg border border-line bg-surface px-3 py-1.5 font-medium hover:border-accent hover:text-accent">
                  Next
                </Link>
              ) : (
                <span aria-disabled="true" className="cursor-not-allowed rounded-lg border border-dashed border-line px-3 py-1.5 text-muted">Next</span>
              )}
            </nav>
          )}
          {total > EXPORT_LIMIT && (
            <p className="text-xs text-muted">
              The CSV holds the first {int(EXPORT_LIMIT)} employers in this order. Narrow the filters to
              export the rest.
            </p>
          )}
          <p className="text-xs text-muted">
            Source: DOL LCA disclosure files, certified cases only; a dash in the USCIS column means no
            USCIS {uLabel} record matched the employer; mean wage over certified full-time LCAs with a
            valid annual wage. <Link href="/sources" className="underline">Sources</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
