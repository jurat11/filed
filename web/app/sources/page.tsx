import type { Metadata } from "next";
import { int } from "@/lib/format";
import { meta, sources } from "@/lib/queries";

// Rebuilt when `filed load` purges the data cache; one day otherwise.
export const revalidate = 86400;
export const metadata: Metadata = { title: "Sources and method" };

const REPO = "https://github.com/jurat11/filed/blob/main";

const d = (v: string | Date | null) => (v ? new Date(v).toISOString().slice(0, 10) : "");

export default async function Sources() {
  const [files, m] = await Promise.all([sources(), meta()]);
  const data = files.filter((f) => f.kind !== "record_layout");
  const layouts = files.filter((f) => f.kind === "record_layout");
  const uLabel = (JSON.parse(m.uscis_years ?? "[]") as number[]).map((y) => `FY${y}`).join(", ") || "none";

  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-semibold tracking-tight">Sources and method</h1>
      <p className="mt-2 text-muted">
        Every figure on this site is computed from the files below and nothing else. Loaded{" "}
        {m.loaded_at?.slice(0, 10)}.
      </p>

      <h2 className="mt-8 text-lg font-semibold">Files loaded</h2>
      <div className="mt-3 overflow-x-auto">
        <table className="num w-full min-w-[720px] text-sm">
          <thead className="text-left text-muted">
            <tr className="border-b border-line">
              <th className="py-2 font-normal">File</th>
              <th className="font-normal">Decisions covered</th>
              <th className="text-right font-normal">Raw rows</th>
              <th className="text-right font-normal">Loaded</th>
              <th className="pl-4 font-normal">Downloaded</th>
              <th className="pl-4 font-normal">SHA-256</th>
            </tr>
          </thead>
          <tbody>
            {data.map((f) => (
              <tr key={f.file} className="border-b border-line align-top">
                <td className="py-2">
                  <a href={f.source_url} className="underline">{f.file}</a>
                </td>
                <td className="text-muted">
                  {f.decision_date_min ? `${d(f.decision_date_min)} to ${d(f.decision_date_max)}` : ""}
                </td>
                <td className="text-right">{int(f.raw_rows)}</td>
                <td className="text-right">{int(f.loaded_rows)}</td>
                <td className="pl-4">{d(f.downloaded)}</td>
                <td className="pl-4 font-mono text-xs" title={f.sha256}>{f.sha256.slice(0, 12)}…</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-sm text-muted">
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

      <h2 className="mt-10 text-lg font-semibold">Definitions</h2>
      <dl className="mt-3 space-y-3 text-sm">
        <div>
          <dt className="font-medium">LCA</dt>
          <dd className="text-muted">
            A Labor Condition Application (Form ETA-9035), filed with the Department of Labor
            before an H-1B, H-1B1 or E-3 petition. Certified means DOL certified it; withdrawn
            includes certified-then-withdrawn. An LCA is not a petition or a visa.
          </dd>
        </div>
        <div>
          <dt className="font-medium">Offered wage</dt>
          <dd className="text-muted">
            The lower bound of the wage range on the LCA, annualized: Year x1, Month x12,
            Bi-Weekly x26, Week x52, Hour x2080. Values under $15,000 or over $1,000,000 are
            treated as unit errors and left out of wage figures (4,570 of 2,136,934 cases).
          </dd>
        </div>
        <div>
          <dt className="font-medium">Wage level</dt>
          <dd className="text-muted">
            The prevailing wage level (I to IV) stated on the LCA. For the FY2027 cap season
            onward, the H-1B lottery enters a registration once at level I, twice at II, three
            times at III and four times at IV; the rule took effect February 27, 2026.
          </dd>
        </div>
        <div>
          <dt className="font-medium">USCIS initial and continuing</dt>
          <dd className="text-muted">
            From the USCIS H-1B Employer Data Hub: first decisions on petitions, counted in
            workers. Initial covers new employment (including a change of status from F-1);
            continuing covers extensions, amendments and changes of employer. Years loaded:{" "}
            {uLabel}. USCIS publishes files through FY2023; later years come from its
            interactive viewer when a download has been added.
          </dd>
        </div>
        <div>
          <dt className="font-medium">Employer</dt>
          <dd className="text-muted">
            One federal tax ID (FEIN). FY2023 files omit the FEIN, so FY2023 LCAs are linked by
            normalized name and state (94.4% linked). Different FEINs are never merged. USCIS
            records are matched by normalized name, state and the last four tax ID digits.
          </dd>
        </div>
        <div>
          <dt className="font-medium">Entry-level signal</dt>
          <dd className="text-muted">
            Certified LCAs in software, data, finance and quant roles at wage level I or II, and
            their share of all the employer&rsquo;s certified LCAs, over the last two fiscal
            years. A count, not a probability of sponsorship.
          </dd>
        </div>
      </dl>

      <h2 className="mt-10 text-lg font-semibold">Limitations</h2>
      <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-muted">
        <li>An LCA is filed before a petition. It shows intent to hire, not an approved visa.</li>
        <li>USCIS data lags; USCIS years loaded: {uLabel}.</li>
        <li>
          Matching by FEIN and name can split one company across legal entities (Amazon.com
          Services and Amazon Web Services are separate employers) or miss a USCIS record.
        </li>
        <li>Cap-exempt employers (universities, some nonprofits) are not flagged separately.</li>
        <li>
          Internships usually run on CPT and first jobs on OPT, which these files do not cover.
        </li>
        <li>
          About 1.5% of FY2024 and FY2025 cases in DOL&rsquo;s worksites files have no row in
          its main files.
        </li>
      </ul>
      <p className="mt-6 text-sm">
        Full method and every judgment call:{" "}
        <a href={`${REPO}/docs/decisions.md`} className="underline">decisions</a>,{" "}
        <a href={`${REPO}/docs/definitions.md`} className="underline">definitions</a>,{" "}
        <a href={`${REPO}/eval`} className="underline">evaluation reports</a>.
      </p>
    </div>
  );
}
