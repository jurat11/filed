import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { StackedBar } from "@/components/Bar";
import { SourceTag } from "@/components/SourceTag";
import { TrendLine } from "@/components/TrendLine";
import { int, MISSING, n, pct, usd } from "@/lib/format";
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

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

export default async function EmployerPage({ params }: { params: Promise<{ slug: string }> }) {
  const [d, uYears, lYears] = await Promise.all([
    employer((await params).slug),
    uscisYears(),
    lcaYears(),
  ]);
  if (!d) notFound();
  const { e, years, uscis, roles, top, aliases, signal, links, similar } = d;
  const uLabel = uYears.map((y) => `FY${y}`).join(", ") || "none";
  const latest2 = years.slice(-2) as Row[];
  const latest = years.at(-1) as Row | undefined;
  const lastFys = latest2.map((y) => n(y.fiscal_year));
  const roles2 = (roles as Row[]).filter((r) => lastFys.includes(n(r.fiscal_year)));
  const sig = (signal as Row[]).find((s) => s.role_selection === "swe_data_fin");
  const srcRows = sum(latest2, "filed");
  const lastSrc = latest2.map((y) => `FY${y.fiscal_year}`).join(" and ");

  return (
    <div>
      <p className="text-sm text-muted">
        {[e.city, e.state].filter(Boolean).join(", ")}
        {e.fein && <span className="ml-3 font-mono">FEIN {e.fein}</span>}
      </p>
      <h1 className="mt-1 text-3xl font-semibold tracking-tight">{e.display_name}</h1>
      <div className="mt-3 flex flex-wrap gap-2 text-sm">
        {!e.has_lca && (
          <span className="rounded bg-accent-soft px-2 py-0.5">No LCA match: USCIS data only</span>
        )}
        {e.h1b_dependent_latest && (
          <span className="rounded bg-accent-soft px-2 py-0.5">
            H-1B dependent (as reported on its latest LCAs)
          </span>
        )}
        {e.willful_violator_ever && (
          <span className="rounded bg-accent-soft px-2 py-0.5 text-warn">
            Reported as a willful violator on an LCA
          </span>
        )}
      </div>

      {e.has_lca && latest && (
        <>
          <Section title="LCAs by fiscal year">
            <TrendLine
              title="Certified LCAs by fiscal year"
              points={(years as Row[]).map((y) => ({
                label: `FY${String(y.fiscal_year)}`,
                value: n(y.certified),
                partial: (n(y.quarter) ?? 4) < 4,
              }))}
            />
            <div className="mt-4 overflow-x-auto">
              <table className="num w-full min-w-[640px] text-sm">
                <thead className="text-left text-muted">
                  <tr className="border-b border-line">
                    <th className="py-2 font-normal">Fiscal year</th>
                    <th className="text-right font-normal">Filed</th>
                    <th className="text-right font-normal">Certified</th>
                    <th className="text-right font-normal">Withdrawn</th>
                    <th className="text-right font-normal">Denied</th>
                    <th className="text-right font-normal">Certified workers</th>
                    <th className="pl-4 font-normal">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {(years as Row[]).map((y) => (
                    <tr key={String(y.fiscal_year)} className="border-b border-line">
                      <td className="py-2">FY{String(y.fiscal_year)}</td>
                      <td className="text-right">{int(y.filed)}</td>
                      <td className="text-right">{int(y.certified)}</td>
                      <td className="text-right">{int(y.withdrawn)}</td>
                      <td className="text-right">{int(y.denied)}</td>
                      <td className="text-right">{int(y.certified_workers)}</td>
                      <td className="pl-4">
                        <SourceTag file={String(y.source_file)} rows={y.filed} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-muted">
              FY2026 covers October 1, 2025 to June 30, 2026 (the latest DOL release). Withdrawn
              includes certified-then-withdrawn.
            </p>
          </Section>

          <Section title="Offered wage, annualized">
            <p className="mb-3 text-sm text-muted">
              Certified, full-time LCAs with a valid wage. 25th percentile, median and 75th
              percentile.
            </p>
            <div className="space-y-3">
              {(years as Row[]).map((y) => {
                const max = Math.max(...(years as Row[]).map((r) => n(r.wage_p75) ?? 0), 1);
                const w = (v: unknown) => `${(100 * (n(v) ?? 0)) / max}%`;
                return (
                  <div key={String(y.fiscal_year)} className="grid grid-cols-[64px_1fr] items-center gap-3 text-sm sm:grid-cols-[64px_1fr_300px]">
                    <span className="text-muted">FY{String(y.fiscal_year)}</span>
                    {n(y.wage_rows) ? (
                      <div className="relative h-4 rounded bg-line/50">
                        <div
                          className="absolute h-4 rounded bg-[var(--bar-3)]"
                          style={{ left: w(y.wage_p25), width: `calc(${w(y.wage_p75)} - ${w(y.wage_p25)})` }}
                        />
                        <div className="absolute h-4 w-0.5 bg-[var(--bar)]" style={{ left: w(y.wage_median) }} />
                      </div>
                    ) : (
                      <span className="text-muted">No valid wages</span>
                    )}
                    <span className="num col-span-2 sm:col-span-1">
                      {usd(y.wage_p25)} / <b>{usd(y.wage_median)}</b> / {usd(y.wage_p75)}{" "}
                      <SourceTag file={String(y.source_file)} rows={y.wage_rows} />
                    </span>
                  </div>
                );
              })}
            </div>
          </Section>

          <Section title={`Wage level mix, ${lastSrc}`}>
            <StackedBar
              parts={[
                { label: "Level I", value: sum(latest2, "level_i") },
                { label: "Level II", value: sum(latest2, "level_ii") },
                { label: "Level III", value: sum(latest2, "level_iii") },
                { label: "Level IV", value: sum(latest2, "level_iv") },
                { label: "Not stated", value: sum(latest2, "level_none") },
              ]}
            />
            <p className="mt-3 text-sm">
              Since the FY2027 cap season, the H-1B lottery gives a registration 1 entry at wage
              level I, 2 at II, 3 at III and 4 at IV (rule effective February 27, 2026).{" "}
              <a href={LOTTERY_URL} className="underline">USCIS announcement</a>. Levels shown are
              those on past LCAs.
            </p>
            <div className="mt-2">
              <SourceTag file={latest2.map((y) => y.source_file).join(" + ")} rows={sum(latest2, "certified")} />
            </div>
          </Section>

          <Section title={`Role groups, ${lastSrc}`}>
            <StackedBar
              parts={ROLE_GROUPS.map((g) => ({
                label: g,
                value: sum(roles2.filter((r) => r.role_group === g), "certified"),
              }))}
            />
          </Section>

          <Section title={`Offered wage by role group, ${lastSrc}`}>
            <p className="mb-3 text-sm text-muted">
              Certified, full-time LCAs with a valid wage, per fiscal year. Percentiles are not
              combined across years.
            </p>
            <div className="overflow-x-auto">
              <table className="num w-full min-w-[640px] text-sm">
                <thead className="text-left text-muted">
                  <tr className="border-b border-line">
                    <th className="py-2 font-normal">Role group</th>
                    <th className="font-normal">Year</th>
                    <th className="text-right font-normal">Certified</th>
                    <th className="text-right font-normal">25th pct</th>
                    <th className="text-right font-normal">Median</th>
                    <th className="text-right font-normal">75th pct</th>
                    <th className="pl-4 font-normal">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {ROLE_GROUPS.flatMap((g) =>
                    roles2
                      .filter((r) => r.role_group === g)
                      .map((r) => {
                        const y = latest2.find((l) => n(l.fiscal_year) === n(r.fiscal_year));
                        return (
                          <tr key={`${g}-${String(r.fiscal_year)}`} className="border-b border-line">
                            <td className="py-2">{g}</td>
                            <td>FY{String(r.fiscal_year)}</td>
                            <td className="text-right">{int(r.certified)}</td>
                            <td className="text-right">{usd(r.wage_p25)}</td>
                            <td className="text-right font-semibold">{usd(r.wage_median)}</td>
                            <td className="text-right">{usd(r.wage_p75)}</td>
                            <td className="pl-4">
                              <SourceTag file={String(y?.source_file ?? "")} rows={r.wage_rows} />
                            </td>
                          </tr>
                        );
                      }),
                  )}
                </tbody>
              </table>
            </div>
          </Section>

          {sig && (
            <Section title="Entry-level signal">
              <div className="rounded-md border border-line bg-surface p-4">
                <p className="num text-2xl font-semibold">
                  {int(sig.entry_lcas)}{" "}
                  <span className="text-base font-normal text-muted">
                    entry-level LCAs, {pct(sig.entry_lcas, sig.certified_all)} of{" "}
                    {int(sig.certified_all)} certified, FY{String(sig.years).replace("-", " to FY")}
                  </span>
                </p>
                <p className="mt-3 font-mono text-xs text-muted">
                  entry-level LCAs = certified LCAs in Software engineering, Data and analytics,
                  Finance, or Quant and actuarial at wage level I or II
                  <br />
                  share = entry-level LCAs / all certified LCAs, same fiscal years
                </p>
                <p className="mt-2 text-sm">
                  USCIS initial approvals, same years:{" "}
                  {!sig.uscis_years_loaded ? (
                    <span className="text-muted">
                      not loaded (USCIS years loaded: {uLabel})
                    </span>
                  ) : sig.uscis_initial === null ? (
                    <span className="text-muted">no USCIS record matched this employer</span>
                  ) : (
                    int(sig.uscis_initial)
                  )}
                </p>
                <p className="mt-2 text-xs text-muted">
                  A count of past filings, not a probability of sponsorship.
                </p>
              </div>
            </Section>
          )}

          <div className="grid gap-8 sm:grid-cols-2">
            {(["title", "state"] as const).map((kind) => {
              const rows = (top as Row[]).filter(
                (t) => t.kind === kind && n(t.fiscal_year) === n(latest.fiscal_year),
              );
              return (
                <Section
                  key={kind}
                  title={`Top ${kind === "title" ? "job titles" : "worksite states"}, FY${String(latest.fiscal_year)}`}
                >
                  <ol className="num space-y-1 text-sm">
                    {rows.map((t) => (
                      <li key={String(t.value)} className="flex justify-between gap-4">
                        <span>{String(t.value)}</span>
                        <span className="text-muted">{int(t.certified)}</span>
                      </li>
                    ))}
                  </ol>
                  <div className="mt-2">
                    <SourceTag file={String(latest.source_file)} rows={latest.certified} />
                  </div>
                </Section>
              );
            })}
          </div>
        </>
      )}

      <Section title="USCIS petition decisions">
        {uscis.length === 0 ? (
          <p className="text-sm text-muted">
            No USCIS Data Hub record matched this employer. USCIS years loaded: {uLabel}.
          </p>
        ) : (
          <div className="overflow-x-auto">
          <table className="num w-full min-w-[640px] text-sm">
            <thead className="text-left text-muted">
              <tr className="border-b border-line">
                <th className="py-2 font-normal">Fiscal year</th>
                <th className="text-right font-normal">Initial approved</th>
                <th className="text-right font-normal">of which new employment</th>
                <th className="text-right font-normal">Initial denied</th>
                <th className="text-right font-normal">Continuing approved</th>
                <th className="text-right font-normal">Continuing denied</th>
                <th className="pl-4 font-normal">Source</th>
              </tr>
            </thead>
            <tbody>
              {(uscis as Row[]).map((u) => (
                <tr key={String(u.fiscal_year)} className="border-b border-line">
                  <td className="py-2">FY{String(u.fiscal_year)}</td>
                  <td className="text-right">{int(u.initial_approvals)}</td>
                  <td className="text-right">{int(u.new_employment_approvals)}</td>
                  <td className="text-right">{int(u.initial_denials)}</td>
                  <td className="text-right">{int(u.continuing_approvals)}</td>
                  <td className="text-right">{int(u.continuing_denials)}</td>
                  <td className="pl-4">
                    <SourceTag file={String(u.source_file)} rows={u.rows} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
        {uscis.length > 0 && (
          <p className="mt-2 text-xs text-muted">
            Initial = New Employment + New Concurrent (a change of status from F-1 counts as New
            Employment). The FY2023 file reports initial and continuing only, so New Employment is
            shown as {MISSING} for it.
          </p>
        )}
      </Section>

      {links.length > 0 && (
        <Section title="Related legal entities">
          <p className="mb-3 text-sm text-muted">
            These employers file under a different federal tax ID (FEIN) but have the same
            normalized name. Filed never merges different FEINs; each keeps its own figures.
          </p>
          <ul className="space-y-1 text-sm">
            {links.map((l) => (
              <li key={l.slug} className="flex flex-wrap justify-between gap-x-4">
                <Link href={`/employer/${l.slug}`} className="underline">
                  {l.display_name}
                </Link>
                <span className="num text-muted">
                  {l.fein ? `FEIN ${l.fein}, ` : ""}
                  {l.state ?? ""} {l.has_lca ? `${int(l.certified_total)} certified LCAs` : "no LCA match"}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {similar.length > 0 && (
        <Section title="Similar employers">
          <p className="mb-3 text-sm text-muted">
            Same NAICS industry code ({e.naics}, the code on most of this employer&rsquo;s LCAs) and
            same employer state ({e.state}), ranked by certified LCAs across all loaded years.
          </p>
          <ol className="num space-y-1 text-sm">
            {similar.map((s) => (
              <li key={s.slug} className="flex justify-between gap-4">
                <Link href={`/employer/${s.slug}`} className="underline">
                  {s.display_name}
                </Link>
                <span className="text-muted">{int(s.certified_total)} certified</span>
              </li>
            ))}
          </ol>
          <div className="mt-2">
            <SourceTag
              label={`DOL LCA FY${Math.min(...lYears)}-FY${Math.max(...lYears)}, all releases`}
              rows={similar.reduce((t, s) => t + (n(s.certified_total) ?? 0), 0)}
            />
          </div>
        </Section>
      )}

      <Section title="Name variants seen">
        <ul className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          {aliases.slice(0, 40).map((a) => (
            <li key={a.source + a.name} className="flex justify-between gap-4">
              <span>{a.name}</span>
              <span className="num shrink-0 text-muted">
                {int(a.rows)} {a.source === "uscis" ? "USCIS rows" : "LCAs"}
              </span>
            </li>
          ))}
        </ul>
        {aliases.length > 40 && (
          <p className="mt-2 text-xs text-muted">and {aliases.length - 40} more</p>
        )}
        <p className="mt-3 text-xs text-muted">
          LCAs are grouped by the employer&rsquo;s federal tax ID (FEIN). A few one-off names
          under a large employer are usually another company&rsquo;s FEIN typo. {int(srcRows)} LCAs
          in the last two fiscal years.
        </p>
      </Section>
    </div>
  );
}
