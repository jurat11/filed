import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BarList, LevelBar, TrendLine, WageRanges } from "@/components/charts";
import { Scroll } from "@/components/Scroll";
import { SourceTag } from "@/components/SourceTag";
import { Badge, Card, Explain, Icon, StatTile } from "@/components/ui";
import { CAP_EXEMPT_RULES } from "@/lib/capExempt";
import { int, MISSING, n, pct, quarterEnd, usd } from "@/lib/format";
import { employer, lcaYears, ROLE_GROUPS, uscisYears } from "@/lib/queries";

// Pages are rendered on first request and cached until `filed load` purges the data
// cache (docs/decisions.md D24), with a one-day fallback.
export const revalidate = 86400;
export function generateStaticParams() {
  return [];
}

const LOTTERY_URL =
  "https://www.uscis.gov/newsroom/news-releases/dhs-changes-process-for-awarding-h-1b-work-visas-to-better-protect-american-workers";

type Row = Record<string, unknown>;
const sum = (rows: Row[], k: string) => rows.reduce((s, r) => s + (n(r[k]) ?? 0), 0);

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const d = await employer((await params).slug);
  if (!d) return { title: "Employer not found" };
  const { e, years } = d;
  const last = years.at(-1);
  const description = last
    ? `${e.display_name}: ${int(last.certified)} certified H-1B LCAs in FY${String(last.fiscal_year)}` +
      ` (DOL LCA disclosure data), wage levels, offered pay and USCIS approvals.`
    : `${e.display_name}: USCIS H-1B Employer Data Hub records. No DOL LCA match.`;
  return {
    title: e.display_name,
    description,
    alternates: { canonical: `/employer/${e.slug}` },
    openGraph: { title: `${e.display_name} | Filed`, description, type: "article" },
  };
}

function initials(name: string) {
  return name
    .replace(/[^A-Za-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !/^(THE|INC|LLC|LLP|CORP)$/i.test(w))
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");
}

export default async function EmployerPage({ params }: { params: Promise<{ slug: string }> }) {
  const [d, uYears, lYears] = await Promise.all([employer((await params).slug), uscisYears(), lcaYears()]);
  if (!d) notFound();
  const { e, years, uscis, roles, top, aliases, signal, links, similar, group } = d;
  const uLabel = uYears.map((y) => `FY${y}`).join(", ") || "none";
  const yrs = years as Row[];
  const latest2 = yrs.slice(-2);
  const latest = yrs.at(-1);
  const lastFys = latest2.map((y) => n(y.fiscal_year));
  const roles2 = (roles as Row[]).filter((r) => lastFys.includes(n(r.fiscal_year)));
  const sig = (signal as Row[]).find((s) => s.role_selection === "swe_data_fin");
  const srcRows = sum(latest2, "filed");
  const lastSrc = latest2.map((y) => `FY${y.fiscal_year}`).join(" and ");
  const lastUscis = (uscis as Row[]).at(-1);
  const partial = latest && (n(latest.quarter) ?? 4) < 4;
  const coverage = latest ? quarterEnd(Number(latest.fiscal_year), n(latest.quarter) ?? 4) : null;
  const hasRelated = links.length > 0 || group.length > 0 || similar.length > 0;

  const sections = [
    e.has_lca && latest && ["overview", "Filings"],
    e.has_lca && latest && ["pay", "Pay"],
    e.has_lca && latest && ["roles", "Roles"],
    ["uscis", "USCIS"],
    hasRelated && ["related", "Related"],
    ["names", "Names"],
  ].filter(Boolean) as [string, string][];

  return (
    <div className="space-y-6">
      <nav aria-label="Breadcrumb" className="text-sm text-muted">
        <Link href="/" className="hover:text-ink">Search</Link>
        <span aria-hidden className="mx-2">/</span>
        <span className="text-ink-2">{e.display_name}</span>
      </nav>

      <header className="card p-6 sm:p-8">
        <div className="flex items-start gap-4 sm:gap-5">
          <span aria-hidden className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-accent-soft text-lg font-semibold text-accent sm:h-14 sm:w-14">
            {initials(e.display_name)}
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{e.display_name}</h1>
            <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
              {(e.city || e.state) && (
                <span className="inline-flex items-center gap-1">
                  <Icon name="map" className="h-3.5 w-3.5" />
                  {[e.city, e.state].filter(Boolean).join(", ")}
                </span>
              )}
              {e.fein && <span className="font-mono">FEIN {e.fein}</span>}
              {e.naics && <span>NAICS {e.naics}</span>}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {!e.has_lca && <Badge tone="warn" icon="alert">No LCA match: USCIS data only</Badge>}
              {e.h1b_dependent_latest && <Badge>H-1B dependent (as reported on its latest LCAs)</Badge>}
              {e.cap_exempt_rule && <Badge tone="accent" icon="grad">Likely cap-exempt</Badge>}
              {e.willful_violator_ever && <Badge tone="warn" icon="alert">Reported as a willful violator on an LCA</Badge>}
            </div>
          </div>
        </div>
        {e.cap_exempt_rule && (
          <p className="mt-5 rounded-xl bg-accent-soft px-4 py-3 text-sm text-ink-2">
            Likely cap-exempt because {CAP_EXEMPT_RULES[e.cap_exempt_rule] ?? e.cap_exempt_rule}. Cap-exempt
            employers (universities, their affiliated nonprofits, nonprofit and government research
            organizations) hire outside the H-1B lottery. This is a rule applied to the data, not a USCIS
            determination; a for-profit college can match it.{" "}
            <Link href="/sources#cap-exempt" className="font-medium text-accent underline">The rule</Link>
          </p>
        )}
      </header>

      {sections.length > 1 && (
        <nav aria-label="On this page" className="sticky top-16 z-30 -mx-4 border-b border-line bg-bg/85 px-4 py-2 backdrop-blur">
          <ul className="flex gap-1 overflow-x-auto text-sm">
            {sections.map(([id, label]) => (
              <li key={id}>
                <a href={`#${id}`} className="block whitespace-nowrap rounded-lg px-3 py-1.5 font-medium text-muted transition hover:bg-surface-2 hover:text-ink">
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      )}

      {e.has_lca && latest && (
        <>
          <section aria-label="At a glance" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile
              icon="file"
              label={`Certified LCAs, FY${String(latest.fiscal_year)}`}
              value={int(latest.certified)}
              note={`${int(latest.filed)} filed${partial ? `, through ${coverage}` : ""}`}
              source={<SourceTag file={String(latest.source_file)} rows={latest.filed} />}
            />
            <StatTile
              icon="dollar"
              label={`Median offered pay, FY${String(latest.fiscal_year)}`}
              value={usd(latest.wage_median)}
              note="Yearly, certified full-time LCAs"
              source={<SourceTag file={String(latest.source_file)} rows={latest.wage_rows} />}
            />
            <StatTile
              icon="grad"
              label="Entry-level share"
              value={sig ? pct(sig.entry_lcas, sig.certified_all) : MISSING}
              note={
                sig
                  ? `${int(sig.entry_lcas)} software, data, finance or quant LCAs at level I or II, ${lastSrc}`
                  : "Not computed for this employer"
              }
              source={sig ? <SourceTag file={latest2.map((y) => y.source_file).join(" + ")} rows={sig.certified_all} /> : undefined}
            />
            <StatTile
              icon="users"
              label={lastUscis ? `USCIS initial approvals, FY${String(lastUscis.fiscal_year)}` : "USCIS initial approvals"}
              value={lastUscis ? int(lastUscis.initial_approvals) : MISSING}
              note={lastUscis ? "Workers new to H-1B employment with this employer" : `No USCIS record matched. Years loaded: ${uLabel}`}
              source={lastUscis ? <SourceTag file={String(lastUscis.source_file)} rows={lastUscis.rows} /> : undefined}
            />
          </section>

          <Card id="overview" title="LCAs by fiscal year" description="Every Labor Condition Application this employer filed, by the status DOL gave it.">
            <TrendLine
              title="Certified LCAs by fiscal year"
              points={yrs.map((y) => ({ label: `FY${String(y.fiscal_year)}`, value: n(y.certified), partial: (n(y.quarter) ?? 4) < 4 }))}
            />
            <Scroll label="LCAs by fiscal year" className="-mx-5 mt-4 border-t border-line">
              <table className="data-table num w-full min-w-[640px] text-sm">
                <thead className="text-left">
                  <tr>
                    <th scope="col">Fiscal year</th>
                    <th scope="col" className="text-right">Filed</th>
                    <th scope="col" className="text-right">Certified</th>
                    <th scope="col" className="text-right">Withdrawn</th>
                    <th scope="col" className="text-right">Denied</th>
                    <th scope="col" className="text-right">Certified workers</th>
                    <th scope="col">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {yrs.map((y) => (
                    <tr key={String(y.fiscal_year)}>
                      <td className="font-medium">FY{String(y.fiscal_year)}</td>
                      <td className="text-right">{int(y.filed)}</td>
                      <td className="text-right font-medium">{int(y.certified)}</td>
                      <td className="text-right">{int(y.withdrawn)}</td>
                      <td className="text-right">{int(y.denied)}</td>
                      <td className="text-right">{int(y.certified_workers)}</td>
                      <td>
                        <SourceTag file={String(y.source_file)} rows={y.filed} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Scroll>
            <p className="mt-3 text-xs text-muted">
              {partial && `FY${String(latest.fiscal_year)} covers October 1, ${Number(latest.fiscal_year) - 1} to ${coverage} (the latest DOL release). `}
              Withdrawn includes certified-then-withdrawn.
            </p>
            <Explain summary="What is an LCA, and what do these statuses mean?">
              <p>
                A Labor Condition Application is the form an employer files with the Department of Labor
                before an H-1B, H-1B1 or E-3 petition. It names the job, the worksite and the wage.
              </p>
              <p>
                <b>Certified</b> means DOL accepted it. <b>Withdrawn</b> means the employer withdrew it.
                <b> Denied</b> means DOL rejected it. A certified LCA shows intent to hire into a role; it
                is not a visa and not a petition approval.
              </p>
            </Explain>
          </Card>

          <Card id="pay" title="Offered pay" description="Yearly pay on certified, full-time LCAs with a valid wage. The bar spans the 25th to 75th percentile; the tick is the median.">
            <WageRanges
              rows={yrs.map((y) => ({
                label: `FY${String(y.fiscal_year)}`,
                p25: y.wage_p25,
                median: y.wage_median,
                p75: y.wage_p75,
                count: y.wage_rows,
                source: <SourceTag file={String(y.source_file)} rows={y.wage_rows} />,
              }))}
            />
            <h3 className="mt-8 text-sm font-semibold">Offered wage by role group, {lastSrc}</h3>
            <p className="mt-1 text-sm text-muted">
              Per fiscal year; percentiles are not combined across years. The prevailing wage is the wage
              DOL requires for the occupation, area and level on each LCA, annualized the same way.
            </p>
            <Scroll label="Offered wage by role group" className="-mx-5 mt-3 border-t border-line">
              <table className="data-table num w-full min-w-[720px] text-sm">
                <thead className="text-left">
                  <tr>
                    <th scope="col">Role group</th>
                    <th scope="col">Year</th>
                    <th scope="col" className="text-right">Certified</th>
                    <th scope="col" className="text-right">25th pct</th>
                    <th scope="col" className="text-right">Median</th>
                    <th scope="col" className="text-right">75th pct</th>
                    <th scope="col" className="text-right">Prevailing wage, median</th>
                    <th scope="col">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {ROLE_GROUPS.flatMap((g) =>
                    roles2
                      .filter((r) => r.role_group === g)
                      .map((r) => {
                        const y = latest2.find((l) => n(l.fiscal_year) === n(r.fiscal_year));
                        return (
                          <tr key={`${g}-${String(r.fiscal_year)}`}>
                            <td>{g}</td>
                            <td>FY{String(r.fiscal_year)}</td>
                            <td className="text-right">{int(r.certified)}</td>
                            <td className="text-right">{usd(r.wage_p25)}</td>
                            <td className="text-right font-semibold">{usd(r.wage_median)}</td>
                            <td className="text-right">{usd(r.wage_p75)}</td>
                            <td className="text-right text-muted">{usd(r.pw_median)}</td>
                            <td>
                              <SourceTag file={String(y?.source_file ?? "")} rows={r.wage_rows} />
                            </td>
                          </tr>
                        );
                      }),
                  )}
                </tbody>
              </table>
            </Scroll>

            <h3 className="mt-8 text-sm font-semibold">Wage level mix, {lastSrc}</h3>
            <p className="mb-4 mt-1 text-sm text-muted">The prevailing wage level the employer chose on each certified LCA. Level I is the entry level.</p>
            <LevelBar
              parts={[
                { label: "Level I", value: sum(latest2, "level_i") },
                { label: "Level II", value: sum(latest2, "level_ii") },
                { label: "Level III", value: sum(latest2, "level_iii") },
                { label: "Level IV", value: sum(latest2, "level_iv") },
                { label: "Not stated", value: sum(latest2, "level_none") },
              ]}
            />
            <p className="mt-4 text-sm text-ink-2">
              Since the FY2027 cap season, the H-1B lottery gives a registration 1 entry at wage level I, 2
              at II, 3 at III and 4 at IV (rule effective February 27, 2026).{" "}
              <a href={LOTTERY_URL} className="font-medium text-accent underline">USCIS announcement</a>. Levels
              shown are those on past LCAs.
            </p>
            <div className="mt-3">
              <SourceTag file={latest2.map((y) => y.source_file).join(" + ")} rows={sum(latest2, "certified")} />
            </div>
            <Explain summary="How is pay calculated?">
              <p>
                Filed uses the lower end of the pay range on each LCA (the figure the employer commits to)
                and turns it into a yearly amount: hourly x 2,080, weekly x 52, every two weeks x 26,
                monthly x 12.
              </p>
              <p>
                Amounts under $15,000 or over $1,000,000 a year are almost always a unit typo (a salary
                entered as hourly), so they are left out of pay figures but still counted as LCAs.
              </p>
            </Explain>
          </Card>

          <Card id="roles" title={`Role groups, ${lastSrc}`} description="Certified LCAs by occupation group (from the SOC code on each LCA).">
            <BarList
              items={ROLE_GROUPS.map((g) => ({
                label: g,
                value: sum(roles2.filter((r) => r.role_group === g), "certified"),
              }))}
            />

            {sig && (
              <div className="mt-8 rounded-2xl border border-line p-5">
                <h3 className="text-sm font-semibold">Entry-level signal</h3>
                <p className="mt-2 text-2xl font-semibold tracking-tight">
                  {int(sig.entry_lcas)}{" "}
                  <span className="text-base font-normal text-muted">
                    entry-level LCAs, {pct(sig.entry_lcas, sig.certified_all)} of {int(sig.certified_all)} certified, FY
                    {String(sig.years).replace("-", " to FY")}
                  </span>
                </p>
                <p className="mt-3 rounded-lg bg-surface-2 px-3 py-2 font-mono text-xs text-muted">
                  entry-level LCAs = certified LCAs in Software engineering, Data and analytics, Finance, or
                  Quant and actuarial at wage level I or II
                  <br />
                  share = entry-level LCAs / all certified LCAs, same fiscal years
                </p>
                <p className="mt-3 text-sm">
                  USCIS initial approvals, same years:{" "}
                  {!sig.uscis_years_loaded ? (
                    <span className="text-muted">not loaded (USCIS years loaded: {uLabel})</span>
                  ) : sig.uscis_initial === null ? (
                    <span className="text-muted">no USCIS record matched this employer</span>
                  ) : (
                    <b>{int(sig.uscis_initial)}</b>
                  )}
                </p>
                <p className="mt-2 text-xs text-muted">A count of past filings, not a probability of sponsorship.</p>
              </div>
            )}

            <div className="mt-8 grid gap-6 sm:grid-cols-2">
              {(["title", "state"] as const).map((kind) => {
                const rows = (top as Row[]).filter((t) => t.kind === kind && n(t.fiscal_year) === n(latest.fiscal_year));
                return (
                  <div key={kind}>
                    <h3 className="text-sm font-semibold">
                      Top {kind === "title" ? "job titles" : "worksite states"}, FY{String(latest.fiscal_year)}
                    </h3>
                    <ol className="num mt-3 divide-y divide-line text-sm">
                      {rows.map((t, i) => (
                        <li key={String(t.value)} className="flex items-center justify-between gap-4 py-2">
                          <span className="flex min-w-0 items-center gap-3">
                            <span className="w-4 text-xs text-muted">{i + 1}</span>
                            <span className="truncate">{String(t.value)}</span>
                          </span>
                          <span className="text-muted">{int(t.certified)}</span>
                        </li>
                      ))}
                    </ol>
                    <div className="mt-2">
                      <SourceTag file={String(latest.source_file)} rows={latest.certified} />
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </>
      )}

      <Card id="uscis" title="USCIS petition decisions" description="From the USCIS H-1B Employer Data Hub, matched by name, state and the last four tax ID digits." flush={uscis.length > 0}>
        {uscis.length === 0 ? (
          <p className="text-sm text-muted">No USCIS Data Hub record matched this employer. USCIS years loaded: {uLabel}.</p>
        ) : (
          <>
            <Scroll label="USCIS petition decisions" className="border-t border-line">
              <table className="data-table num w-full min-w-[720px] text-sm">
                <thead className="text-left">
                  <tr>
                    <th scope="col">Fiscal year</th>
                    <th scope="col" className="text-right">Initial approved</th>
                    <th scope="col" className="text-right">of which new employment</th>
                    <th scope="col" className="text-right">Initial denied</th>
                    <th scope="col" className="text-right">Continuing approved</th>
                    <th scope="col" className="text-right">Continuing denied</th>
                    <th scope="col">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {(uscis as Row[]).map((u) => (
                    <tr key={String(u.fiscal_year)}>
                      <td className="font-medium">FY{String(u.fiscal_year)}</td>
                      <td className="text-right font-medium">{int(u.initial_approvals)}</td>
                      <td className="text-right">{int(u.new_employment_approvals)}</td>
                      <td className="text-right">{int(u.initial_denials)}</td>
                      <td className="text-right">{int(u.continuing_approvals)}</td>
                      <td className="text-right">{int(u.continuing_denials)}</td>
                      <td>
                        <SourceTag file={String(u.source_file)} rows={u.rows} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Scroll>
            <div className="px-5 pb-5">
              <p className="mt-3 text-xs text-muted">
                Initial = New Employment + New Concurrent (a change of status from F-1 counts as New
                Employment). The FY2023 file reports initial and continuing only, so New Employment is shown
                as {MISSING} for it.
              </p>
              <Explain summary="Initial or continuing: what is the difference?">
                <p>
                  <b>Initial</b> approvals are workers new to H-1B employment with this employer, including a
                  student moving from F-1 (OPT) status. <b>Continuing</b> covers extensions, amendments and
                  workers changing to this employer from another H-1B employer.
                </p>
                <p>USCIS counts workers, not forms, and reports the first decision on each petition.</p>
              </Explain>
            </div>
          </>
        )}
      </Card>

      {hasRelated && (
        <div id="related" className="grid gap-6 lg:grid-cols-2">
          {links.length > 0 && (
            <Card title="Related legal entities" description="Same normalized name, different federal tax ID (FEIN). Never merged; each keeps its own figures.">
              <ul className="divide-y divide-line text-sm">
                {links.map((l) => (
                  <li key={l.slug} className="flex flex-wrap items-center justify-between gap-x-4 py-2.5">
                    <Link href={`/employer/${l.slug}`} className="font-medium text-accent hover:underline">
                      {l.display_name}
                    </Link>
                    <span className="num text-muted">
                      {l.fein ? `FEIN ${l.fein}, ` : ""}
                      {l.state ?? ""} {l.has_lca ? `${int(l.certified_total)} certified LCAs` : "no LCA match"}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {group.length > 0 && (
            <Card title="Related entities (reviewed)">
              <p className="mb-3 text-sm text-muted">
                A person reviewed evidence that these employers belong to {group[0].group_name}. Each is a
                separate FEIN with its own figures.{" "}
                <Link href={`/group/${group[0].group_slug}`} className="font-medium text-accent underline">
                  See them side by side
                </Link>
              </p>
              <ul className="divide-y divide-line text-sm">
                {group
                  .filter((m) => m.slug !== e.slug)
                  .map((m) => (
                    <li key={m.slug} className="flex flex-wrap items-center justify-between gap-x-4 py-2.5">
                      <Link href={`/employer/${m.slug}`} className="font-medium text-accent hover:underline">{m.display_name}</Link>
                      <span className="num text-muted">FEIN {m.fein}, {int(m.certified_total)} certified LCAs</span>
                    </li>
                  ))}
              </ul>
            </Card>
          )}

          {similar.length > 0 && (
            <Card title="Similar employers">
              <p className="mb-3 text-sm text-muted">
                Same NAICS industry code ({e.naics}, the code on most of this employer&rsquo;s LCAs) and same
                employer state ({e.state}), ranked by certified LCAs across all loaded years.
              </p>
              <ol className="num divide-y divide-line text-sm">
                {similar.map((s) => (
                  <li key={s.slug} className="flex items-center justify-between gap-4 py-2.5">
                    <Link href={`/employer/${s.slug}`} className="font-medium text-accent hover:underline">
                      {s.display_name}
                    </Link>
                    <span className="text-muted">{int(s.certified_total)} certified</span>
                  </li>
                ))}
              </ol>
              <div className="mt-3">
                <SourceTag
                  label={`DOL LCA FY${Math.min(...lYears)}-FY${Math.max(...lYears)}, all releases`}
                  rows={similar.reduce((t, s) => t + (n(s.certified_total) ?? 0), 0)}
                />
              </div>
            </Card>
          )}
        </div>
      )}

      <Card id="names" title="Name variants seen" description="Every spelling this employer used on its filings.">
        <ul className="grid gap-x-8 gap-y-1 text-sm sm:grid-cols-2">
          {aliases.slice(0, 40).map((a) => (
            <li key={a.source + a.name} className="flex justify-between gap-4 border-b border-line py-1.5">
              <span className="truncate">{a.name}</span>
              <span className="num shrink-0 text-muted">
                {int(a.rows)} {a.source === "uscis" ? "USCIS rows" : "LCAs"}
              </span>
            </li>
          ))}
        </ul>
        {aliases.length > 40 && <p className="mt-2 text-xs text-muted">and {aliases.length - 40} more</p>}
        <p className="mt-3 text-xs text-muted">
          LCAs are grouped by the employer&rsquo;s federal tax ID (FEIN). A few one-off names under a large
          employer are usually another company&rsquo;s FEIN typo. {int(srcRows)} LCAs in the last two fiscal
          years.
        </p>
      </Card>
    </div>
  );
}
