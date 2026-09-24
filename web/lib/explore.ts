/**
 * /explore filters: parsing untrusted query strings and building the SQL.
 *
 * Pure (no database, no "server-only") so it can be unit tested. Every user value goes
 * into the query as a bind parameter; the only strings spliced into the SQL text come from
 * the constant tables below, chosen by whitelisted keys.
 */

export const ROLE_GROUPS = [
  "Software engineering",
  "Data and analytics",
  "Finance",
  "Quant and actuarial",
  "IT and systems",
  "Engineering",
  "Other",
];
export const LEVELS = ["I", "II", "III", "IV"];

/** USPS codes that can appear as a worksite state, plus "??" for a missing state. */
export const STATES = [
  "AK", "AL", "AR", "AS", "AZ", "CA", "CO", "CT", "DC", "DE", "FL", "FM", "GA", "GU", "HI",
  "IA", "ID", "IL", "IN", "KS", "KY", "LA", "MA", "MD", "ME", "MH", "MI", "MN", "MO", "MP",
  "MS", "MT", "NC", "ND", "NE", "NH", "NJ", "NM", "NV", "NY", "OH", "OK", "OR", "PA", "PR",
  "PW", "RI", "SC", "SD", "TN", "TX", "UT", "VA", "VI", "VT", "WA", "WI", "WV", "WY",
];

export const PAGE_SIZE = 50;
export const EXPORT_LIMIT = 5000;
const MAX_MIN = 1_000_000_000;

export type ExploreParams = {
  role: string[];
  state: string[];
  level: string[];
  fy: string; // a loaded fiscal year or "all"
  min: number;
  hideDependent: boolean;
  hideCapExempt: boolean;
  sort: string;
  page: number; // 1-based
};

export const SORTS: Record<string, string> = {
  certified: "certified DESC",
  wage: "avg_wage DESC NULLS LAST",
  uscis: "uscis_initial_total DESC NULLS LAST",
  name: "display_name ASC",
};

type SP = Record<string, string | string[] | undefined>;

const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

function intParam(v: string | string[] | undefined, lo: number, hi: number, dflt: number) {
  const s = (one(v) ?? "").trim();
  if (!/^\d{1,10}$/.test(s)) return dflt;
  return Math.min(hi, Math.max(lo, Number(s)));
}

/**
 * Parse /explore search params. Anything unrecognized falls back to the default instead
 * of reaching the database. `years` (the loaded fiscal years) limits `fy` when given.
 */
export function parseExplore(sp: SP, years?: number[]): ExploreParams {
  const list = (k: string) =>
    ([] as string[])
      .concat(sp[k] ?? [])
      .flatMap((v) => String(v).split(","))
      .map((v) => v.trim())
      .filter(Boolean);
  const uniq = (xs: string[]) => [...new Set(xs)];
  const fy = one(sp.fy)?.trim() ?? "all";
  const fyOk = /^\d{4}$/.test(fy) && (!years || years.includes(Number(fy)));
  const sort = one(sp.sort)?.trim() ?? "";
  return {
    role: uniq(list("role").filter((r) => ROLE_GROUPS.includes(r))),
    state: uniq(list("state").map((s) => s.toUpperCase()).filter((s) => STATES.includes(s))),
    level: uniq(list("level").filter((l) => LEVELS.includes(l))),
    fy: fyOk ? fy : "all",
    min: intParam(sp.min, 0, MAX_MIN, 0),
    hideDependent: one(sp.hide_dependent) === "1",
    hideCapExempt: one(sp.hide_cap_exempt) === "1",
    sort: has(SORTS, sort) ? sort : "certified",
    page: intParam(sp.page, 1, 100_000, 1),
  };
}

/** Canonical query string for a set of params (defaults left out), for links and export. */
export function exploreQuery(p: ExploreParams, patch: Partial<ExploreParams> = {}): string {
  const q = { ...p, ...patch };
  const u = new URLSearchParams();
  for (const r of q.role) u.append("role", r);
  if (q.state.length) u.set("state", q.state.join(","));
  if (q.level.length) u.set("level", q.level.join(","));
  if (q.fy !== "all") u.set("fy", q.fy);
  if (q.min) u.set("min", String(q.min));
  if (q.hideDependent) u.set("hide_dependent", "1");
  if (q.hideCapExempt) u.set("hide_cap_exempt", "1");
  if (q.sort !== "certified") u.set("sort", q.sort);
  if (q.page > 1) u.set("page", String(q.page));
  return u.toString();
}

/**
 * SQL for the explore table. `limit`/`offset` page through the result; the row order is
 * total (ties broken by name, then slug), so a page and the CSV export list the same
 * employers in the same order.
 */
export function exploreSql(p: ExploreParams, limit: number, offset = 0) {
  const where: string[] = [];
  const values: unknown[] = [];
  const bind = (v: unknown) => {
    values.push(v);
    return `$${values.length}`;
  };
  if (p.fy !== "all") where.push(`c.fiscal_year = ${bind(Number(p.fy))}`);
  if (p.role.length) where.push(`c.role_group = ANY(${bind(p.role)})`);
  if (p.state.length) where.push(`c.worksite_state = ANY(${bind(p.state)})`);
  if (p.level.length) where.push(`c.wage_level = ANY(${bind(p.level)})`);
  if (p.hideDependent) where.push("e.h1b_dependent_latest IS NOT TRUE");
  if (p.hideCapExempt) where.push("e.cap_exempt_rule IS NULL");
  const min = bind(p.min);
  const lim = bind(Math.max(0, Math.min(limit, EXPORT_LIMIT)));
  const off = bind(Math.max(0, offset));
  const text = `
    SELECT e.slug, e.display_name, e.state, e.uscis_initial_total, e.h1b_dependent_latest,
           e.cap_exempt_rule,
           sum(c.certified)::int AS certified, sum(c.wage_rows)::int AS wage_rows,
           round(sum(c.wage_sum) / nullif(sum(c.wage_rows), 0)) AS avg_wage,
           count(*) OVER ()::int AS total_rows
      FROM filed.lca_cube c JOIN filed.employers e USING (employer_id)
     ${where.length ? "WHERE " + where.join(" AND ") : ""}
     GROUP BY e.employer_id, e.slug, e.display_name, e.state, e.uscis_initial_total,
              e.h1b_dependent_latest, e.cap_exempt_rule
    HAVING sum(c.certified) >= ${min}
     ORDER BY ${SORTS[p.sort]}, e.display_name, e.slug
     LIMIT ${lim} OFFSET ${off}`;
  return { text, values };
}

export type ExploreRow = {
  slug: string;
  display_name: string;
  state: string | null;
  certified: number;
  wage_rows: number;
  avg_wage: number | null;
  uscis_initial_total: number | null;
  h1b_dependent_latest: boolean | null;
  cap_exempt_rule: string | null;
  total_rows: number;
};

/** CSV columns. The USCIS column names the fiscal years it sums, e.g. "fy2023". */
export function csvHeader(uscisYears: number[]): string[] {
  const fy = uscisYears.length ? "fy" + uscisYears.join("_fy") : "not_loaded";
  return [
    "employer",
    "state",
    "certified_lcas",
    "mean_offered_wage",
    "wage_rows",
    `uscis_initial_approvals_${fy}`,
    "h1b_dependent_latest",
    "likely_cap_exempt_rule",
    "url",
  ];
}

/** One CSV cell. Missing values are empty cells, never 0. Cells that a spreadsheet would
 * read as a formula are prefixed with an apostrophe. */
export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? "" : String(v);
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: ExploreRow[], uscisYears: number[]): string {
  const body = rows.map((r) =>
    [
      r.display_name,
      r.state,
      r.certified,
      r.avg_wage,
      r.wage_rows,
      r.uscis_initial_total,
      r.h1b_dependent_latest,
      r.cap_exempt_rule,
      `/employer/${r.slug}`,
    ]
      .map(csvCell)
      .join(","),
  );
  return [csvHeader(uscisYears).join(","), ...body].join("\n") + "\n";
}
