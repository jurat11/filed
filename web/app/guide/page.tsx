import type { Metadata } from "next";
import Link from "next/link";
import { Card, Icon, PageHeader } from "@/components/ui";
import { quarterEnd } from "@/lib/format";
import { siteStats, uscisYears } from "@/lib/queries";

export const metadata: Metadata = {
  title: "Guide: how to read the numbers",
  description:
    "Plain-English definitions of LCAs, wage levels, offered pay, USCIS approvals and every other figure on Filed, and what the data cannot tell you.",
  alternates: { canonical: "/guide" },
};

const TERMS: { term: string; id: string; body: React.ReactNode }[] = [
  {
    term: "LCA (Labor Condition Application)",
    id: "lca",
    body: (
      <>
        The form (ETA-9035) an employer files with the Department of Labor before it can file an H-1B,
        H-1B1 or E-3 petition. It states the job title, the occupation code, the worksite and the wage.
        One LCA can cover more than one worker.
      </>
    ),
  },
  {
    term: "Certified, withdrawn, denied",
    id: "status",
    body: (
      <>
        <b>Certified</b>: DOL accepted the LCA. <b>Withdrawn</b>: the employer withdrew it (Filed also
        counts &ldquo;certified, then withdrawn&rdquo; here). <b>Denied</b>: DOL rejected it.
        <b> Filed</b> means all of them together.
      </>
    ),
  },
  {
    term: "Offered wage",
    id: "wage",
    body: (
      <>
        The lower end of the pay range on the LCA, which is the amount the employer commits to, turned
        into a yearly figure (hourly x 2,080, weekly x 52, every two weeks x 26, monthly x 12). Pay
        figures use certified, full-time LCAs only, and leave out amounts under $15,000 or over
        $1,000,000 a year, which are nearly always unit typos.
      </>
    ),
  },
  {
    term: "Wage level (I to IV)",
    id: "level",
    body: (
      <>
        The prevailing wage level the employer chose for the job, from the government&rsquo;s wage survey
        for that occupation and area. <b>Level I is the entry level</b>, IV the most senior. It shows where
        an employer usually files; it is not the level USCIS will assign to a future registration.
      </>
    ),
  },
  {
    term: "Prevailing wage",
    id: "prevailing",
    body: (
      <>
        The minimum wage DOL requires for that occupation, area and level. The employer page shows its
        median next to the offered pay, so you can see how far above the floor an employer pays.
      </>
    ),
  },
  {
    term: "Entry-level signal",
    id: "entry",
    body: (
      <>
        A count and a share: certified LCAs in software, data, finance and quant roles at wage level I or
        II, out of all the employer&rsquo;s certified LCAs, over the last two loaded fiscal years. It is a
        count of past filings, not a probability of sponsorship.
      </>
    ),
  },
  {
    term: "USCIS initial and continuing approvals",
    id: "uscis",
    body: (
      <>
        From the USCIS H-1B Employer Data Hub. <b>Initial</b>: workers new to H-1B employment with that
        employer, including a student moving from F-1 (OPT). <b>Continuing</b>: extensions, amendments and
        workers moving from another H-1B employer. USCIS counts workers and reports its first decision on
        each petition.
      </>
    ),
  },
  {
    term: "H-1B dependent",
    id: "dependent",
    body: (
      <>
        The employer&rsquo;s own answer in the &ldquo;H-1B dependent&rdquo; field of its latest LCAs. Filed
        shows what the employer reported and does not check it.
      </>
    ),
  },
  {
    term: "Likely cap-exempt",
    id: "cap-exempt",
    body: (
      <>
        Universities, their affiliated nonprofits and nonprofit research organizations hire outside the
        H-1B lottery. Filed flags an employer as <i>likely</i> cap-exempt by a stated rule (its NAICS code,
        its name, or IRS nonprofit records when loaded). It is not a USCIS determination.{" "}
        <Link href="/sources#cap-exempt" className="font-medium text-accent underline">The rule</Link>
      </>
    ),
  },
  {
    term: "Employer, FEIN and related entities",
    id: "employer",
    body: (
      <>
        An employer on Filed is one federal tax ID (FEIN). Big companies often file under several legal
        entities, and Filed never merges them; related entities are linked on each page instead, each with
        its own figures.
      </>
    ),
  },
];

export default async function Guide() {
  const [stats, uYears] = await Promise.all([siteStats(), uscisYears()]);
  const through = stats.latestYear && stats.latestQuarter ? quarterEnd(stats.latestYear, stats.latestQuarter) : null;

  return (
    <div>
      <PageHeader eyebrow="Guide" title="How to read the numbers">
        Every figure on Filed comes from a government file. This page explains, in plain English, what
        each one means, and what the data cannot tell you.
      </PageHeader>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start">
        <div className="space-y-6">
          <Card title="The paper trail" description="Where each step shows up in the data.">
            <ol className="grid gap-4 sm:grid-cols-4">
              {[
                ["Employer files an LCA", "with the Department of Labor"],
                ["DOL certifies it", "or it is withdrawn or denied"],
                ["Employer files a petition", "with USCIS"],
                ["USCIS decides", "approves or denies the petition"],
              ].map(([t, d], i) => (
                <li key={t} className="relative rounded-xl bg-surface-2 p-4">
                  <span className="text-xs font-semibold text-accent">Step {i + 1}</span>
                  <p className="mt-1 text-sm font-medium">{t}</p>
                  <p className="mt-0.5 text-sm text-muted">{d}</p>
                </li>
              ))}
            </ol>
            <p className="mt-4 text-sm text-muted">
              Steps 1 and 2 come from DOL&rsquo;s LCA disclosure files; steps 3 and 4 from the USCIS H-1B
              Employer Data Hub. An LCA shows that an employer intended to hire into a role. It is not a
              petition and not a visa.
            </p>
          </Card>

          <Card title="Terms">
            <dl className="divide-y divide-line">
              {TERMS.map((t) => (
                <div key={t.id} id={t.id} className="grid gap-1 py-4 first:pt-0 last:pb-0 sm:grid-cols-[14rem_1fr] sm:gap-6">
                  <dt className="font-medium">{t.term}</dt>
                  <dd className="text-sm leading-6 text-ink-2">{t.body}</dd>
                </div>
              ))}
            </dl>
          </Card>

          <Card title="What the data cannot tell you">
            <ul className="space-y-3 text-sm text-ink-2">
              {[
                "An LCA is filed before a petition. It shows intent to hire, not an approved visa.",
                "USCIS data lags DOL data, and later USCIS years are published only in an interactive viewer; the years loaded are listed below.",
                "Internships usually run on CPT and first jobs on OPT, which these files do not cover.",
                "Matching by tax ID and name can split one company across legal entities or miss a USCIS record.",
                "Past filings do not guarantee future sponsorship. This is not legal advice.",
              ].map((x) => (
                <li key={x} className="flex gap-3">
                  <Icon name="alert" className="mt-0.5 h-4 w-4 text-warn" />
                  <span>{x}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <aside className="space-y-6 lg:sticky lg:top-24">
          <Card title="How current is it?">
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-muted">DOL LCA data through</dt>
                <dd className="font-medium">
                  {through ?? "–"}
                  {stats.latestYear && ` (FY${stats.latestYear} Q${stats.latestQuarter})`}
                </dd>
              </div>
              <div>
                <dt className="text-muted">USCIS years loaded</dt>
                <dd className="font-medium">{uYears.map((y) => `FY${y}`).join(", ") || "none"}</dd>
              </div>
              <div>
                <dt className="text-muted">Release schedule</dt>
                <dd>DOL publishes each quarter; a watcher opens an issue when a new file appears.</dd>
              </div>
            </dl>
            <Link href="/sources" className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline">
              Every file, with its hash <Icon name="arrow" className="h-3.5 w-3.5" />
            </Link>
          </Card>
          <Card title="On this page">
            <ul className="space-y-1.5 text-sm">
              {TERMS.map((t) => (
                <li key={t.id}>
                  <a href={`#${t.id}`} className="text-muted hover:text-accent">
                    {t.term}
                  </a>
                </li>
              ))}
            </ul>
          </Card>
        </aside>
      </div>
    </div>
  );
}
