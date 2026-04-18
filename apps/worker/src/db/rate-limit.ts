import type { RateLimitSnapshot } from "../types";

export async function upsertRateLimit(db: D1Database, snapshot: RateLimitSnapshot): Promise<void> {
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO rate_limit_state (id, limit_total, remaining, reset_at, updated_at)
       VALUES (1, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         limit_total = excluded.limit_total,
         remaining = excluded.remaining,
         reset_at = excluded.reset_at,
         updated_at = excluded.updated_at`,
    )
    .bind(snapshot.limitTotal, snapshot.remaining, snapshot.resetAt.toISOString(), now)
    .run();
}

export async function selectRateLimit(db: D1Database): Promise<RateLimitSnapshot | null> {
  const row = await db
    .prepare("SELECT limit_total, remaining, reset_at FROM rate_limit_state WHERE id = 1")
    .first<{ limit_total: number; remaining: number; reset_at: string }>();
  if (!row) return null;
  return {
    limitTotal: row.limit_total,
    remaining: row.remaining,
    resetAt: new Date(row.reset_at),
  };
}
