import { Scroll } from "@/components/Scroll";
import type { Metadata } from "next";
import { Card, PageHeader } from "@/components/ui";
import { int } from "@/lib/format";
import { meta, sources } from "@/lib/queries";

// Rebuilt when `filed load` purges the data cache; one day otherwise.
export const revalidate = 86400;
export const metadata: Metadata = {
  title: "Sources and method",
  description: "Every government file behind Filed, with its download date, row counts and SHA-256, plus definitions and limitations.",
  alternates: { canonical: "/sources" },
};

const REPO = "https://github.com/jurat11/filed/blob/main";

const d = (v: string | Date | null) => (v ? new Date(v).toISOString().slice(0, 10) : "");

export default async function Sources() {
  const [files, m] = await Promise.all([sources(), meta()]);
  const data = files.filter((f) => f.kind !== "record_layout");
  const layouts = files.filter((f) => f.kind === "record_layout");
  const uLabel = (JSON.parse(m.uscis_years ?? "[]") as number[]).map((y) => `FY${y}`).join(", ") || "none";

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Sources" title="Sources and method">
        Every figure on this site is computed from the files below and nothing else. Loaded{" "}
        {m.loaded_at?.slice(0, 10)}.
      </PageHeader>

      <Card title="Files loaded" description="Raw rows are counted straight from each file; loaded rows must match." flush>
      <Scroll label="Files loaded" className="border-t border-line">
        <table className="data-table num w-full min-w-[720px] text-sm">
          <thead className="text-left">
            <tr>
              <th scope="col">File</th>
              <th scope="col">Decisions covered</th>
              <th scope="col" className="text-right">Raw rows</th>
              <th scope="col" className="text-right">Loaded</th>
              <th scope="col">Downloaded</th>
              <th scope="col">SHA-256</th>
            </tr>
          </thead>
          <tbody>
            {data.map((f) => (
              <tr key={f.file} className="align-top">
                <td>
                  <a href={f.source_url} className="underline">{f.file}</a>
                </td>
                <td className="text-muted">
                  {f.decision_date_min ? `${d(f.decision_date_min)} to ${d(f.decision_date_max)}` : ""}
                </td>
                <td className="text-right">{int(f.raw_rows)}</td>
                <td className="text-right">{int(f.loaded_rows)}</td>
                <td>{d(f.downloaded)}</td>
                <td className="font-mono text-xs" title={f.sha256}>{f.sha256.slice(0, 12)}…</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Scroll>
      <p className="border-t border-line px-5 py-4 text-sm text-muted">
        Column mappings were written from the DOL record layouts:{" "}
        {layouts.map((f, i) => (
          <span key={f.file}>
            {i > 0 && ", "}
            <a href={f.source_url} className="underline">{f.file}</a>
          </span>
        ))}
        . Raw rows are counted straight from each spreadsheet; loaded rows must match. FY2023 to
        FY2025 releases each hold one quarter (FY2023 Q2 holds two), so every quarter is loaded
        and a case repeated in a later quarter keeps its latest status.
      </p>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:items-start">
      <Card title="Definitions">
      <dl className="space-y-4 text-sm">
        <div>
          <dt className="font-medium">LCA</dt>
          <dd className="mt-0.5 text-muted">
            A Labor Condition Application (Form ETA-9035), filed with the Department of Labor
            before an H-1B, H-1B1 or E-3 petition. Certified means DOL certified it; withdrawn
            includes certified-then-withdrawn. An LCA is not a petition or a visa.
          </dd>
        </div>
        <div>
          <dt className="font-medium">Offered wage</dt>
          <dd className="mt-0.5 text-muted">
            The lower bound of the wage range on the LCA, annualized: Year x1, Month x12,
            Bi-Weekly x26, Week x52, Hour x2080. Values under $15,000 or over $1,000,000 are
            treated as unit errors and left out of wage figures (4,570 of 2,136,934 cases).
          </dd>
        </div>
        <div>
          <dt className="font-medium">Wage level</dt>
          <dd className="mt-0.5 text-muted">
            The prevailing wage level (I to IV) stated on the LCA. For the FY2027 cap season
            onward, the H-1B lottery enters a registration once at level I, twice at II, three
            times at III and four times at IV; the rule took effect February 27, 2026.
          </dd>
        </div>
        <div>
          <dt className="font-medium">USCIS initial and continuing</dt>
          <dd className="mt-0.5 text-muted">
            From the USCIS H-1B Employer Data Hub: first decisions on petitions, counted in
            workers. Initial covers new employment (including a change of status from F-1);
            continuing covers extensions, amendments and changes of employer. Years loaded:{" "}
            {uLabel}. USCIS publishes files through FY2023; later years come from its
            interactive viewer when a download has been added.
          </dd>
        </div>
        <div>
          <dt className="font-medium">Employer</dt>
          <dd className="mt-0.5 text-muted">
            One federal tax ID (FEIN). FY2023 files omit the FEIN, so FY2023 LCAs are linked by
            normalized name and state (94.4% linked). Different FEINs are never merged. USCIS
            records are matched by normalized name, state and the last four tax ID digits.
          </dd>
        </div>
        <div id="cap-exempt">
          <dt className="font-medium">Likely cap-exempt</dt>
          <dd className="mt-0.5 text-muted">
            A rule, not a USCIS determination. An employer is flagged when the IRS lists its tax ID
            as a 501(c)(3) in higher education or research (when that IRS file is loaded), or when
            most of its LCAs give NAICS 611310 (colleges and universities), or when its name
            contains University, College, Institute of Technology, School of Medicine or Medical
            School and its NAICS code is in education or health care. The last two rules do not
            check nonprofit status, so a for-profit college can match.
          </dd>
        </div>
        <div>
          <dt className="font-medium">Related entities</dt>
          <dd className="mt-0.5 text-muted">
            Employers with different FEINs are never merged. Two views connect them: legal entities
            that share a normalized name, and groups from a small parent map that a person reviewed
            against public evidence. Both show each employer&rsquo;s own figures.
          </dd>
        </div>
        <div>
          <dt className="font-medium">Entry-level signal</dt>
          <dd className="mt-0.5 text-muted">
            Certified LCAs in software, data, finance and quant roles at wage level I or II, and
            their share of all the employer&rsquo;s certified LCAs, over the last two fiscal
            years. A count, not a probability of sponsorship.
          </dd>
        </div>
      </dl>
      </Card>

      <Card title="Limitations">
      <ul className="list-disc space-y-2 pl-5 text-sm text-muted">
        <li>An LCA is filed before a petition. It shows intent to hire, not an approved visa.</li>
        <li>USCIS data lags; USCIS years loaded: {uLabel}.</li>
        <li>
          Matching by FEIN and name can split one company across legal entities (Amazon.com
          Services and Amazon Web Services are separate employers) or miss a USCIS record.
        </li>
        <li>
          &ldquo;Likely cap-exempt&rdquo; is a rule applied to NAICS codes and names (and IRS
          records when loaded), not a USCIS determination.
        </li>
        <li>
          Internships usually run on CPT and first jobs on OPT, which these files do not cover.
        </li>
        <li>
          About 1.5% of FY2024 and FY2025 cases in DOL&rsquo;s worksites files have no row in
          its main files.
        </li>
      </ul>
      <p className="mt-6 border-t border-line pt-4 text-sm">
        Full method and every judgment call:{" "}
        <a href={`${REPO}/docs/decisions.md`} className="underline">decisions</a>,{" "}
        <a href={`${REPO}/docs/definitions.md`} className="underline">definitions</a>,{" "}
        <a href={`${REPO}/eval`} className="underline">evaluation reports</a>.
      </p>
      </Card>
      </div>
    </div>
  );
}
