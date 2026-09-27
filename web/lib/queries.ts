import "server-only";
import { unstable_cache } from "next/cache";
import { sql } from "./db";
import { type ExploreParams, type ExploreRow, exploreSql } from "./explore";
import { normalizeName } from "./names";

export { LEVELS, parseExplore, ROLE_GROUPS } from "./explore";

/**
 * Every query result is cached under the "filed" tag. The data only changes when the ETL
 * swaps in a new schema, and `filed load` then calls /api/revalidate, which purges the tag
 * (docs/decisions.md D24). The one-day revalidate is a fallback in case that call fails.
 */
export const DATA_TAG = "filed";
const DAY = 86_400;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function cached<F extends (...args: any[]) => Promise<unknown>>(name: string, fn: F): F {
  return unstable_cache(fn, ["filed", name], { tags: [DATA_TAG], revalidate: DAY }) as F;
}

export type Employer = {
  employer_id: number;
  slug: string;
  display_name: string;
  fein: string | null;
  city: string | null;
  state: string | null;
  naics: string | null;
  has_lca: boolean;
  has_uscis: boolean;
  // null when the employer has no LCA match (USCIS only) or no USCIS match: missing, not 0.
  lca_rows: number | null;
  certified_total: number | null;
  uscis_initial_total: number | null;
  h1b_dependent_latest: boolean | null;
  willful_violator_ever: boolean;
  cap_exempt_rule: string | null;
};

export type GroupMember = Employer & {
  group_slug: string;
  group_name: string;
  evidence_url: string;
  reviewed_on: string;
};

export const meta = cached("meta", async (): Promise<Record<string, string>> => {
  const rows = await sql<{ key: string; value: string }>("SELECT key, value FROM filed.meta");
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
});

/** filed.meta.loaded_at read straight from the database, bypassing the cache. */
export async function loadedAtFresh(): Promise<string | null> {
  const [r] = await sql<{ value: string }>("SELECT value FROM filed.meta WHERE key = 'loaded_at'");
  return r?.value ?? null;
}

export async function lcaYears(): Promise<number[]> {
  return JSON.parse((await meta()).lca_years ?? "[]");
}

export async function uscisYears(): Promise<number[]> {
  return JSON.parse((await meta()).uscis_years ?? "[]");
}

export type SearchHit = Employer & { matched_alias: string; tier: number };

/**
 * Employers whose name or any name variant matches `q`, normalized the way the ETL
 * normalizes names ("&" and "and" dropped, punctuation and legal suffixes removed).
 * Ranked: exact match, then prefix, then substring (each by certified volume), then
 * fuzzy trigram matches by similarity.
 */
export const search = cached("search", async (q: string, limit = 25): Promise<SearchHit[]> => {
  const norm = normalizeName(q);
  if (norm.length < 2) return [];
  return sql<SearchHit>(
    `WITH hits AS (
       SELECT a.employer_id, a.name, a.rows,
              CASE WHEN a.norm = $1 THEN 0
                   WHEN a.norm LIKE $1 || '%' THEN 1
                   WHEN a.norm LIKE '%' || $1 || '%' THEN 2
                   ELSE 3 END AS tier,
              similarity(a.norm, $1) AS sim
         FROM filed.aliases a
        WHERE a.norm LIKE '%' || $1 || '%' OR a.norm % $1
     ),
     best AS (
       SELECT DISTINCT ON (employer_id) employer_id, name AS matched_alias, tier, sim
         FROM hits ORDER BY employer_id, tier, sim DESC, rows DESC, name
     )
     SELECT e.*, b.matched_alias, b.tier
       FROM best b JOIN filed.employers e USING (employer_id)
      ORDER BY b.tier, CASE WHEN b.tier = 3 THEN b.sim END DESC NULLS LAST,
               e.certified_total DESC NULLS LAST, e.uscis_initial_total DESC NULLS LAST,
               e.display_name, e.slug
      LIMIT $2`,
    [norm, Math.min(Math.max(limit, 1), 50)],
  );
});

type Row = Record<string, unknown>;

export const employer = cached("employer", async (slug: string) => {
  const [e] = await sql<Employer>("SELECT * FROM filed.employers WHERE slug = $1", [slug]);
  if (!e) return null;
  const id = e.employer_id;
  const [years, uscis, roles, top, aliases, signal, links, similar, group] = await Promise.all([
    sql<Row>("SELECT * FROM filed.lca_year WHERE employer_id = $1 ORDER BY fiscal_year", [id]),
    sql<Row>("SELECT * FROM filed.uscis_year WHERE employer_id = $1 ORDER BY fiscal_year", [id]),
    sql<Row>(
      "SELECT * FROM filed.lca_year_role WHERE employer_id = $1 ORDER BY role_group, fiscal_year DESC",
      [id],
    ),
    sql<Row>(
      "SELECT * FROM filed.lca_year_top WHERE employer_id = $1 ORDER BY fiscal_year, kind, rank",
      [id],
    ),
    sql<{ name: string; source: string; rows: number }>(
      "SELECT name, source, rows FROM filed.aliases WHERE employer_id = $1 ORDER BY rows DESC, name",
      [id],
    ),
    sql<Row>("SELECT * FROM filed.entry_signal WHERE employer_id = $1", [id]),
    sql<Employer & { norm_name: string }>(
      `SELECT e.*, l.norm_name FROM filed.links l
         JOIN filed.employers e
           ON e.employer_id = CASE WHEN l.employer_a = $1 THEN l.employer_b ELSE l.employer_a END
        WHERE l.employer_a = $1 OR l.employer_b = $1
        ORDER BY e.certified_total DESC NULLS LAST, e.display_name`,
      [id],
    ),
    e.naics && e.state
      ? sql<Employer>(
          `SELECT * FROM filed.employers
            WHERE naics = $1 AND state = $2 AND employer_id <> $3 AND has_lca
            ORDER BY certified_total DESC NULLS LAST, display_name
            LIMIT 8`,
          [e.naics, e.state, id],
        )
      : Promise.resolve([] as Employer[]),
    groupMembers(
      `(SELECT group_slug FROM filed.groups WHERE employer_id = $1)`,
      [id],
    ),
  ]);
  return { e, years, uscis, roles, top, aliases, signal, links, similar, group };
});

function groupMembers(slugSql: string, args: unknown[]) {
  return sql<GroupMember>(
    `SELECT g.group_slug, g.group_name, g.evidence_url, g.reviewed_on, e.*
       FROM filed.groups g JOIN filed.employers e USING (employer_id)
      WHERE g.group_slug = ${slugSql}
      ORDER BY e.certified_total DESC NULLS LAST, e.display_name`,
    args,
  );
}

/** A reviewed group of FEIN employers (data/parents.csv) with each member's LCA years. */
export const group = cached("group", async (slug: string) => {
  const members = await groupMembers("$1", [slug]);
  if (members.length === 0) return null;
  const years = await sql<Row & { employer_id: number }>(
    `SELECT employer_id, fiscal_year, source_file, filed, certified FROM filed.lca_year
      WHERE employer_id = ANY($1) ORDER BY fiscal_year`,
    [members.map((m) => m.employer_id)],
  );
  return { members, years };
});

export const explore = cached(
  "explore",
  async (p: ExploreParams, limit: number, offset = 0): Promise<ExploreRow[]> => {
    const { text, values } = exploreSql(p, limit, offset);
    return sql<ExploreRow>(text, values);
  },
);

export type SourceFile = {
  file: string;
  kind: string;
  fiscal_year: number | null;
  quarter: number | null;
  source_url: string;
  // Dates arrive as strings once cached.
  downloaded: string | Date;
  sha256: string;
  bytes: string;
  raw_rows: string | null;
  loaded_rows: string | null;
  decision_date_min: string | Date | null;
  decision_date_max: string | Date | null;
};

export const sources = cached("sources", () =>
  sql<SourceFile>("SELECT * FROM filed.sources ORDER BY kind, fiscal_year, quarter, file"),
);

export const SITEMAP_CHUNK = 40_000;

export const employerCount = cached("employerCount", async () => {
  const [r] = await sql<{ n: number }>("SELECT count(*)::int AS n FROM filed.employers");
  return r.n;
});

export const employerSlugs = cached("employerSlugs", (chunk: number) =>
  sql<{ slug: string }>(
    "SELECT slug FROM filed.employers ORDER BY employer_id LIMIT $1 OFFSET $2",
    [SITEMAP_CHUNK, chunk * SITEMAP_CHUNK],
  ),
);

export const groupSlugs = cached("groupSlugs", () =>
  sql<{ group_slug: string }>("SELECT DISTINCT group_slug FROM filed.groups ORDER BY 1"),
);
