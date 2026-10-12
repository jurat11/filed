import Link from "next/link";
import { SearchBox } from "@/components/SearchBox";
import { SourceTag } from "@/components/SourceTag";
import { buttonClass, StatGrid, StatTile } from "@/components/ui";
import { compact, int, quarterEnd } from "@/lib/format";
import { lcaYears, search, siteStats, uscisYears } from "@/lib/queries";
import { aliasNote } from "@/lib/search";

const QUICK = ["Amazon", "Google", "JPMorgan", "Deloitte", "Capital One"];

export default async function Home({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q = "" } = await searchParams;
  const query = q.trim().slice(0, 100);
  const [results, years, uYears, stats] = await Promise.all([
    query.length >= 2 ? search(query) : Promise.resolve([]),
    lcaYears(),
    uscisYears(),
    siteStats(),
  ]);
  const first = Math.min(...years);
  const last = Math.max(...years);
  const lastFull = years.filter((y) => y < last).at(-1) ?? last;
  const through = stats.latestYear && stats.latestQuarter ? quarterEnd(stats.latestYear, stats.latestQuarter) : null;
  const allYears = `DOL LCA FY${first}-FY${last}, all releases`;

  const presets = [
    {
      icon: "chart",
      label: "Entry-level software in Virginia and DC",
      note: `Software engineering, wage level I or II, FY${lastFull}`,
      href: `/explore?role=Software+engineering&state=VA,DC&level=I,II&fy=${lastFull}`,
    },
    {
      icon: "dollar",
      label: "Finance roles, any state",
      note: `Certified LCAs in finance occupations, FY${lastFull}`,
      href: `/explore?role=Finance&fy=${lastFull}`,
    },
    {
      icon: "users",
      label: "Most USCIS initial approvals",
      note: `USCIS Data Hub, ${uYears.map((y) => `FY${y}`).join(", ") || "no year loaded"}`,
      href: "/explore?sort=uscis",
    },
  ];

  return (
    <div>
      <section className="relative border-b border-ink pb-12 sm:pt-4">
        <div className="max-w-3xl">
          <p className="label text-accent">
            Public DOL and USCIS records, FY{first} to FY{last}
          </p>
          <h1 className="mt-4 text-[2.5rem] font-semibold leading-[1.04] tracking-tight sm:text-6xl">
            Which employers file <span className="whitespace-nowrap">H-1B</span> paperwork for{" "}
            <span className="whitespace-nowrap">entry-level</span> roles, and at what pay
          </h1>
          <p className="mt-5 max-w-2xl text-xl leading-snug text-ink-2">
            Look up any employer to see how many Labor Condition Applications it filed, for which
            roles, at what wage level and pay. Every number links to the government file it came
            from.
          </p>

          <form action="/" role="search" className="mt-8 flex flex-col gap-2 sm:flex-row">
            <SearchBox defaultValue={query} />
            <button className={`${buttonClass} h-12 px-6`}>Search</button>
          </form>
          <p className="mt-3 flex flex-wrap items-center gap-x-1 text-[0.9375rem]">
            <span className="label mr-2 text-muted">Try:</span>
            {QUICK.map((w) => (
              <Link
                key={w}
                href={`/?q=${encodeURIComponent(w)}`}
                className="inline-block px-2 py-2 text-ink underline decoration-dotted underline-offset-4 hover:text-accent"
              >
                {w}
              </Link>
            ))}
          </p>
        </div>

        {/* A rubber stamp, in the margin: decorative, and the same facts the line above gives. */}
        <div
          aria-hidden
          className="pointer-events-none absolute right-4 top-8 hidden -rotate-6 select-none border-[3px] border-double border-warn px-5 py-3 text-center text-warn opacity-90 lg:block"
        >
          <div className="pl-[0.3em] font-mono text-4xl font-semibold tracking-[0.3em]">FILED</div>
          <div className="label mt-1.5 border-t border-warn pt-1.5">DOL LCA, FY{first} to FY{last}</div>
          {through && <div className="label mt-0.5">through {through}</div>}
        </div>
      </section>

      {query.length >= 2 && (
        <section aria-labelledby="results-title" className="mt-10">
          <h2 id="results-title" className="label mb-3 text-muted">
            {results.length === 0
              ? `No employer matches “${query}”`
              : `${results.length} employer${results.length === 1 ? "" : "s"} matching “${query}”`}
          </h2>
          {results.length === 0 ? (
            <p className="card p-5 text-[0.9375rem] text-muted">
              Check the spelling, or try a shorter part of the name (for example &ldquo;Capital&rdquo;
              instead of &ldquo;Capital One Services LLC&rdquo;). Names are matched the way the
              government files write them, with &ldquo;&amp;&rdquo;, &ldquo;and&rdquo; and legal
              suffixes such as LLC ignored.
            </p>
          ) : (
            <ol className="divide-y divide-line border-y-2 border-ink bg-surface">
              {results.map((r, i) => (
                <li key={r.slug}>
                  <Link href={`/employer/${r.slug}`} className="group flex items-baseline gap-4 px-4 py-4 transition hover:bg-accent-soft">
                    <span aria-hidden className="w-6 shrink-0 font-mono text-sm text-muted">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-lg font-medium underline-offset-4 group-hover:underline">
                        {r.display_name}
                      </span>
                      <span className="block font-mono text-xs text-muted">
                        {[r.city, r.state].filter(Boolean).join(", ")}
                        {aliasNote(r.display_name, r.matched_alias) && <> · matched &ldquo;{r.matched_alias}&rdquo;</>}
                      </span>
                    </span>
                    <span className="num shrink-0 text-right font-mono">
                      {r.has_lca ? (
                        <>
                          <span className="block text-base font-medium">{int(r.certified_total)}</span>
                          <span className="text-xs text-muted">certified LCAs</span>
                        </>
                      ) : (
                        <span className="text-xs text-warn">no LCA match</span>
                      )}
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
          )}
        </section>
      )}

      <section aria-labelledby="start-title" className="mt-14">
        <h2 id="start-title" className="border-b border-ink pb-2 text-2xl font-semibold tracking-tight">
          Start here
        </h2>
        <ol className="divide-y divide-line border-b border-line">
          {presets.map((p, i) => (
            <li key={p.label} className="group relative grid grid-cols-[2.5rem_1fr] gap-x-2 py-5 transition hover:bg-surface sm:grid-cols-[2.5rem_1fr_auto] sm:items-baseline sm:px-2">
              <span aria-hidden className="font-mono text-sm text-muted">
                {String(i + 1).padStart(2, "0")}
              </span>
              <div>
                <Link
                  href={p.href}
                  className="text-xl font-medium underline-offset-4 after:absolute after:inset-0 group-hover:underline"
                >
                  {p.label}
                </Link>
                <p className="mt-0.5 text-[0.9375rem] text-muted">{p.note}</p>
              </div>
              <span className="label col-start-2 mt-2 text-accent sm:col-start-3 sm:mt-0">Open in Explore &rarr;</span>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="numbers-title" className="mt-14">
        <h2 id="numbers-title" className="mb-4 border-b border-ink pb-2 text-2xl font-semibold tracking-tight">
          What is in the data
        </h2>
        <StatGrid>
          <StatTile
            label="LCAs filed"
            value={compact(stats.filed)}
            note={`${int(stats.certified)} of them certified by DOL`}
            source={<SourceTag label={allYears} rows={stats.filed} />}
          />
          <StatTile
            label="Employers"
            value={compact(stats.employers)}
            note="Grouped by federal tax ID (FEIN)"
            source={<SourceTag label={allYears} rows={stats.filed} />}
          />
          <StatTile
            label="Fiscal years"
            value={String(years.length)}
            note={`FY${first} to FY${last}, from every quarterly DOL release`}
          />
          <StatTile
            label="Up to date through"
            value={through ?? "–"}
            note={`The latest DOL release (FY${stats.latestYear} Q${stats.latestQuarter}). DOL publishes a new one each quarter.`}
          />
        </StatGrid>
      </section>

      <section aria-labelledby="how-title" className="mt-14">
        <h2 id="how-title" className="border-b border-ink pb-2 text-2xl font-semibold tracking-tight">
          How to read what you see
        </h2>
        <ol className="mt-6 grid gap-8 sm:grid-cols-3 sm:gap-0 sm:divide-x sm:divide-line">
          {[
            {
              t: "An employer files an LCA",
              d: "Before an H-1B petition, the employer files a Labor Condition Application with the Department of Labor, stating the job, the place and the wage.",
            },
            {
              t: "Filed counts them",
              d: "For each employer: how many LCAs, for which roles, at which wage level (I is entry level) and at what offered pay, year by year.",
            },
            {
              t: "USCIS decides petitions",
              d: "Where USCIS data is loaded, the employer page also shows its approved and denied H-1B petitions. An LCA alone is not a visa.",
            },
          ].map((s, i) => (
            <li key={s.t} className="sm:px-6 sm:first:pl-0 sm:last:pr-0">
              <span aria-hidden className="block text-5xl font-medium italic leading-none text-accent">
                {i + 1}
              </span>
              <h3 className="mt-3 text-lg font-semibold">{s.t}</h3>
              <p className="mt-1 text-[0.9375rem] text-muted">{s.d}</p>
            </li>
          ))}
        </ol>
        <Link href="/guide" className="mt-8 inline-block py-1 font-medium text-accent underline underline-offset-4 hover:text-accent-hover">
          Read the guide: every term, in plain English &rarr;
        </Link>
      </section>
    </div>
  );
}
