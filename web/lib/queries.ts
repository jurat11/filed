import "server-only";
import { sql } from "./db";
import { type ExploreParams, type ExploreRow, exploreSql } from "./explore";

export { LEVELS, parseExplore, ROLE_GROUPS } from "./explore";

export type Employer = {
  employer_id: number;
  slug: string;
  display_name: string;
  fein: string | null;
  city: string | null;
  state: string | null;
  has_lca: boolean;
  has_uscis: boolean;
  // null when the employer has no LCA match (USCIS only) or no USCIS match: missing, not 0.
  lca_rows: number | null;
  certified_total: number | null;
  uscis_initial_total: number | null;
  h1b_dependent_latest: boolean | null;
  willful_violator_ever: boolean;
};

export async function meta(): Promise<Record<string, string>> {
  const rows = await sql<{ key: string; value: string }>("SELECT key, value FROM filed.meta");
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

export async function lcaYears(): Promise<number[]> {
  return JSON.parse((await meta()).lca_years ?? "[]");
}

export async function uscisYears(): Promise<number[]> {
  return JSON.parse((await meta()).uscis_years ?? "[]");
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

export async function explore(p: ExploreParams, limit: number, offset = 0) {
  const { text, values } = exploreSql(p, limit, offset);
  return sql<ExploreRow>(text, values);
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
