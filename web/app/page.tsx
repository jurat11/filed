import Link from "next/link";
import { SearchBox } from "@/components/SearchBox";
import { SourceTag } from "@/components/SourceTag";
import { buttonClass, Icon, StatTile } from "@/components/ui";
import { compact, int, quarterEnd } from "@/lib/format";
import { lcaYears, search, siteStats, uscisYears } from "@/lib/queries";
import { aliasNote } from "@/lib/search";

const QUICK = ["Amazon", "Google", "JPMorgan", "Deloitte", "Capital One"];

function initials(name: string) {
  return name
    .replace(/[^A-Za-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");
}

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
    <div className="space-y-16">
      <section className="relative overflow-hidden rounded-3xl border border-line bg-surface px-6 py-12 sm:px-12 sm:py-16">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-accent-soft opacity-80 blur-3xl"
        />
        <div className="relative max-w-3xl">
          <p className="inline-flex items-center gap-2 rounded-full bg-accent-soft px-3 py-1 text-xs font-medium text-accent">
            <Icon name="file" className="h-3.5 w-3.5" />
            Public DOL and USCIS records, FY{first} to FY{last}
          </p>
          <h1 className="mt-5 text-4xl font-semibold tracking-tight sm:text-5xl">
            Which employers file H-1B paperwork for entry-level roles, and at what pay
          </h1>
          <p className="mt-4 text-lg text-muted">
            Look up any employer to see how many Labor Condition Applications it filed, for which
            roles, at what wage level and pay. Every number links to the government file it came
            from.
          </p>

          <form action="/" role="search" className="mt-8 flex flex-col gap-2 sm:flex-row">
            <SearchBox defaultValue={query} />
            <button className={`${buttonClass} h-12 px-6 text-base`}>
              <Icon name="search" />
              Search
            </button>
          </form>
          <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted">Try:</span>
            {QUICK.map((w) => (
              <Link
                key={w}
                href={`/?q=${encodeURIComponent(w)}`}
                className="rounded-full border border-line px-3 py-1 text-ink-2 transition hover:border-accent hover:text-accent"
              >
                {w}
              </Link>
            ))}
          </div>
        </div>
      </section>

      {query.length >= 2 && (
        <section aria-labelledby="results-title" className="-mt-8">
          <h2 id="results-title" className="mb-3 text-sm font-medium text-muted">
            {results.length === 0
              ? `No employer matches “${query}”`
              : `${results.length} employer${results.length === 1 ? "" : "s"} matching “${query}”`}
          </h2>
          {results.length === 0 ? (
            <p className="card p-5 text-sm text-muted">
              Check the spelling, or try a shorter part of the name (for example &ldquo;Capital&rdquo;
              instead of &ldquo;Capital One Services LLC&rdquo;). Names are matched the way the
              government files write them, with &ldquo;&amp;&rdquo;, &ldquo;and&rdquo; and legal
              suffixes such as LLC ignored.
            </p>
          ) : (
            <ul className="card divide-y divide-line overflow-hidden">
              {results.map((r) => (
                <li key={r.slug}>
                  <Link
                    href={`/employer/${r.slug}`}
                    className="group flex items-center gap-4 px-5 py-4 transition hover:bg-surface-2"
                  >
                    <span
                      aria-hidden
                      className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent-soft text-sm font-semibold text-accent"
                    >
                      {initials(r.display_name)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium group-hover:text-accent">
                        {r.display_name}
                      </span>
                      <span className="block text-sm text-muted">
                        {[r.city, r.state].filter(Boolean).join(", ")}
                        {aliasNote(r.display_name, r.matched_alias) && (
                          <> · matched &ldquo;{r.matched_alias}&rdquo;</>
                        )}
                      </span>
                    </span>
                    <span className="num shrink-0 text-right text-sm">
                      {r.has_lca ? (
                        <>
                          <span className="block font-semibold">{int(r.certified_total)}</span>
                          <span className="text-muted">certified LCAs</span>
                        </>
                      ) : (
                        <span className="text-warn">no LCA match</span>
                      )}
                    </span>
                    <Icon name="arrow" className="hidden h-4 w-4 text-muted sm:block" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section aria-labelledby="numbers-title">
        <h2 id="numbers-title" className="text-xl font-semibold tracking-tight">
          What is in the data
        </h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            icon="file"
            label="LCAs filed"
            value={compact(stats.filed)}
            note={`${int(stats.certified)} of them certified by DOL`}
            source={<SourceTag label={allYears} rows={stats.filed} />}
          />
          <StatTile
            icon="building"
            label="Employers"
            value={compact(stats.employers)}
            note="Grouped by federal tax ID (FEIN)"
            source={<SourceTag label={allYears} rows={stats.filed} />}
          />
          <StatTile
            icon="chart"
            label="Fiscal years"
            value={String(years.length)}
            note={`FY${first} to FY${last}, from every quarterly DOL release`}
          />
          <StatTile
            icon="check"
            label="Up to date through"
            value={through ?? "–"}
            note={`The latest DOL release (FY${stats.latestYear} Q${stats.latestQuarter}). DOL publishes a new one each quarter.`}
          />
        </div>
      </section>

      <section aria-labelledby="start-title">
        <h2 id="start-title" className="text-xl font-semibold tracking-tight">
          Start here
        </h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          {presets.map((p) => (
            <Link key={p.label} href={p.href} className="card group p-5 transition hover:border-accent">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-accent-soft text-accent">
                <Icon name={p.icon} />
              </span>
              <div className="mt-4 font-medium group-hover:text-accent">{p.label}</div>
              <div className="mt-1 text-sm text-muted">{p.note}</div>
              <div className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-accent">
                Open in Explore <Icon name="arrow" className="h-3.5 w-3.5" />
              </div>
            </Link>
          ))}
        </div>
      </section>

      <section aria-labelledby="how-title" className="card p-6 sm:p-8">
        <h2 id="how-title" className="text-xl font-semibold tracking-tight">
          How to read what you see
        </h2>
        <ol className="mt-6 grid gap-6 sm:grid-cols-3">
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
            <li key={s.t}>
              <span className="grid h-8 w-8 place-items-center rounded-full bg-accent text-sm font-semibold text-accent-ink">
                {i + 1}
              </span>
              <h3 className="mt-3 font-medium">{s.t}</h3>
              <p className="mt-1 text-sm text-muted">{s.d}</p>
            </li>
          ))}
        </ol>
        <Link href="/guide" className="mt-6 inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline">
          Read the guide: every term, in plain English <Icon name="arrow" className="h-3.5 w-3.5" />
        </Link>
      </section>
    </div>
  );
}
