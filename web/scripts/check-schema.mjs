// Runs before `next build`. Refuses to build the site against a database that an older
// ETL loaded, so a merge that needs new tables fails its Vercel build (and the previous
// deployment keeps serving) instead of going live with broken pages. docs/deploy.md.
//
// Keep REQUIRED equal to SCHEMA_VERSION in etl/load.py (tests/test_load.py checks it).
import { pathToFileURL } from "node:url";

export const REQUIRED = 2;

/** What to do given the version the database reports (null: no filed.meta or no key). */
export function verdict(found, required = REQUIRED) {
  if (found === null || Number.isNaN(found) || found < required) {
    return {
      ok: false,
      message:
        `The database holds data loaded with schema version ${found ?? "1 or none"}, ` +
        `and this code needs version ${required}. Run the ETL load with this code first ` +
        "(uv run filed all), then deploy again. See docs/deploy.md.",
    };
  }
  if (found > required) {
    return {
      ok: true,
      message: `The database has schema version ${found}, newer than this code expects (${required}).`,
    };
  }
  return { ok: true, message: `Database schema version ${found} matches.` };
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    if (process.env.VERCEL) {
      console.error("check-schema: DATABASE_URL is not set for this Vercel environment.");
      process.exit(1);
    }
    console.log("check-schema: DATABASE_URL not set, skipped (local build).");
    return;
  }
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 20_000 });
  let found = null;
  let loadedAt = null;
  try {
    await client.connect();
    const { rows } = await client.query(
      "SELECT key, value FROM filed.meta WHERE key IN ('schema_version', 'loaded_at')",
    );
    const meta = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    found = meta.schema_version === undefined ? null : Number(meta.schema_version);
    loadedAt = meta.loaded_at ?? null;
  } catch (e) {
    // 3F000: schema "filed" missing; 42P01: table filed.meta missing. Anything else
    // (network, credentials) is a real failure.
    if (e.code !== "3F000" && e.code !== "42P01") {
      console.error(`check-schema: cannot read filed.meta: ${e.message}`);
      process.exit(1);
    }
  } finally {
    await client.end().catch(() => {});
  }
  const v = verdict(found);
  const line = `check-schema: ${v.message}${loadedAt ? ` (loaded ${loadedAt})` : ""}`;
  if (!v.ok) {
    console.error(line);
    process.exit(1);
  }
  console.log(line);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
