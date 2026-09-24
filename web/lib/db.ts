import "server-only";
import { Pool, type QueryResultRow } from "pg";

const globalForPool = globalThis as unknown as { filedPool?: Pool };

function pool(): Pool {
  if (!globalForPool.filedPool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL is not set");
    globalForPool.filedPool = new Pool({ connectionString, max: 5 });
  }
  return globalForPool.filedPool;
}

export async function sql<T extends QueryResultRow>(text: string, params: unknown[] = []) {
  const res = await pool().query<T>(text, params);
  return res.rows;
}
