import { createHash, timingSafeEqual } from "node:crypto";
import { revalidateTag } from "next/cache";
import { DATA_TAG, loadedAtFresh } from "@/lib/queries";

export const dynamic = "force-dynamic";

const digest = (s: string) => createHash("sha256").update(s).digest();

/**
 * Called by `filed load` after it swaps in a new schema (docs/decisions.md D24):
 *
 *   POST /api/revalidate
 *   Authorization: Bearer $REVALIDATE_SECRET
 *   {"loaded_at": "<filed.meta loaded_at of the load that just finished>"}
 *
 * The cache is purged only once the database serves that load, so a purge can never
 * re-cache the old data. 409 means the database does not show that load yet; retry.
 */
export async function POST(req: Request) {
  const secret = process.env.REVALIDATE_SECRET;
  if (!secret) return Response.json({ error: "REVALIDATE_SECRET is not set" }, { status: 503 });
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!timingSafeEqual(digest(token), digest(secret))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  let body: { loaded_at?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "body must be JSON with loaded_at" }, { status: 400 });
  }
  if (typeof body.loaded_at !== "string") {
    return Response.json({ error: "loaded_at is required" }, { status: 400 });
  }
  const current = await loadedAtFresh();
  if (current !== body.loaded_at) {
    return Response.json({ error: "database does not show this load yet", current }, { status: 409 });
  }
  revalidateTag(DATA_TAG);
  return Response.json({ revalidated: true, loaded_at: current });
}
