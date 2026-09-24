import "server-only";
import { sql } from "./db";

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

export type Employer = {
  employer_id: number;
  slug: string;
  display_name: string;
  fein: string | null;
  city: string | null;
  state: string | null;
  has_lca: boolean;
  has_uscis: boolean;
  lca_rows: number;
  certified_total: number;
  uscis_initial_total: number;
  h1b_dependent_latest: boolean | null;
  willful_violator_ever: boolean;
};

export async function meta(): Promise<Record<string, string>> {
  const rows = await sql<{ key: string; value: string }>("SELECT key, value FROM filed.meta");
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

export async function lcaYears(): Promise<number[]> {
  return JSON.parse((await meta()).lca_years);
}

export async function search(q: string) {
  return sql<Employer & { score: number }>(
    `SELECT e.*, word_similarity($1, search_text) AS score
       FROM filed.employers e
      WHERE $1 <% search_text OR search_text ILIKE '%' || $1 || '%'
      ORDER BY (display_name ILIKE $1 || '%') DESC, score DESC,
               certified_total DESC, uscis_initial_total DESC
      LIMIT 25`,
    [q],
  );
}

export async function employer(slug: string) {
  const [e] = await sql<Employer>("SELECT * FROM filed.employers WHERE slug = $1", [slug]);
  if (!e) return null;
  const id = e.employer_id;
  const [years, uscis, roles, top, aliases, signal] = await Promise.all([
    sql("SELECT * FROM filed.lca_year WHERE employer_id = $1 ORDER BY fiscal_year", [id]),
    sql("SELECT * FROM filed.uscis_year WHERE employer_id = $1 ORDER BY fiscal_year", [id]),
    sql("SELECT * FROM filed.lca_year_role WHERE employer_id = $1", [id]),
    sql(
      "SELECT * FROM filed.lca_year_top WHERE employer_id = $1 ORDER BY fiscal_year, kind, rank",
      [id],
    ),
    sql<{ name: string; source: string; rows: number }>(
      "SELECT name, source, rows FROM filed.aliases WHERE employer_id = $1 ORDER BY rows DESC",
      [id],
    ),
    sql("SELECT * FROM filed.entry_signal WHERE employer_id = $1", [id]),
  ]);
  return { e, years, uscis, roles, top, aliases, signal };
}

export type ExploreParams = {
  role: string[];
  state: string[];
  level: string[];
  fy: string; // a fiscal year or "all"
  min: number;
  hideDependent: boolean;
  sort: string;
};

const SORTS: Record<string, string> = {
  certified: "certified DESC",
  wage: "avg_wage DESC NULLS LAST",
  uscis: "uscis_initial_total DESC NULLS LAST",
  name: "display_name ASC",
};

export function parseExplore(sp: Record<string, string | string[] | undefined>): ExploreParams {
  const list = (k: string) =>
    ([] as string[]).concat(sp[k] ?? []).flatMap((v) => v.split(",")).filter(Boolean);
  return {
    role: list("role").filter((r) => ROLE_GROUPS.includes(r)),
    state: list("state").map((s) => s.toUpperCase().slice(0, 2)),
    level: list("level").filter((l) => LEVELS.includes(l)),
    fy: typeof sp.fy === "string" && /^(\d{4}|all)$/.test(sp.fy) ? sp.fy : "all",
    min: Math.max(0, Number(sp.min) || 0),
    hideDependent: sp.hide_dependent === "1",
    sort: typeof sp.sort === "string" && sp.sort in SORTS ? sp.sort : "certified",
  };
}

export async function explore(p: ExploreParams, limit = 200) {
  const where: string[] = [];
  const args: unknown[] = [];
  const add = (clause: string, v: unknown) => {
    args.push(v);
    where.push(clause.replace("?", `$${args.length}`));
  };
  if (p.fy !== "all") add("c.fiscal_year = ?", Number(p.fy));
  if (p.role.length) add("c.role_group = ANY(?)", p.role);
  if (p.state.length) add("c.worksite_state = ANY(?)", p.state);
  if (p.level.length) add("c.wage_level = ANY(?)", p.level);
  args.push(p.min);
  const minArg = `$${args.length}`;
  const rows = await sql<{
    slug: string;
    display_name: string;
    state: string | null;
    certified: number;
    wage_rows: number;
    avg_wage: number | null;
    uscis_initial_total: number | null;
    h1b_dependent_latest: boolean | null;
  }>(
    `SELECT e.slug, e.display_name, e.state,
            CASE WHEN e.has_uscis THEN e.uscis_initial_total END AS uscis_initial_total,
            e.h1b_dependent_latest,
            sum(c.certified)::int AS certified, sum(c.wage_rows)::int AS wage_rows,
            round(sum(c.wage_sum) / nullif(sum(c.wage_rows), 0)) AS avg_wage
       FROM filed.lca_cube c JOIN filed.employers e USING (employer_id)
      ${where.length ? "WHERE " + where.join(" AND ") : ""}
      ${p.hideDependent ? (where.length ? "AND" : "WHERE") + " e.h1b_dependent_latest IS NOT TRUE" : ""}
      GROUP BY 1, 2, 3, 4, 5
     HAVING sum(c.certified) >= ${minArg}
      ORDER BY ${SORTS[p.sort]}, e.display_name
      LIMIT ${Math.min(limit, 5000)}`,
    args,
  );
  return rows;
}

export async function sources() {
  return sql<{
    file: string;
    kind: string;
    fiscal_year: number | null;
    quarter: number | null;
    source_url: string;
    downloaded: Date;
    sha256: string;
    bytes: string;
    raw_rows: string | null;
    loaded_rows: string | null;
    decision_date_min: Date | null;
    decision_date_max: Date | null;
  }>("SELECT * FROM filed.sources ORDER BY kind, fiscal_year, quarter, file");
}
