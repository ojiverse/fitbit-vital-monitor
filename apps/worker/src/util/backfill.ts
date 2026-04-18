import { addDays, localToUtcIso } from "./time";

export async function findOldestMissingDay(
  db: D1Database,
  metricType: string,
  lookbackDays: number,
  today: string,
): Promise<string | null> {
  const from = addDays(today, -lookbackDays);
  const yesterday = addDays(today, -1);
  const rows = await db
    .prepare("SELECT date FROM vitals_daily WHERE metric_type = ? AND date BETWEEN ? AND ?")
    .bind(metricType, from, yesterday)
    .all<{ date: string }>();
  const present = new Set(rows.results.map((r) => r.date));
  for (let i = lookbackDays; i >= 1; i--) {
    const d = addDays(today, -i);
    if (!present.has(d)) return d;
  }
  return null;
}

export async function findOldestMissingIntradayDay(
  db: D1Database,
  metricType: string,
  lookbackDays: number,
  today: string,
  tz: string,
): Promise<string | null> {
  // Iterate oldest → newest so the first empty day we hit is the one to backfill.
  // Skip today (still being filled by the normal tick) and check [today - lookbackDays, yesterday].
  for (let i = lookbackDays; i >= 1; i--) {
    const date = addDays(today, -i);
    const start = localToUtcIso(date, "00:00:00", tz);
    const end = localToUtcIso(addDays(date, 1), "00:00:00", tz);
    const row = await db
      .prepare(
        "SELECT COUNT(*) AS n FROM vitals WHERE metric_type = ? AND timestamp >= ? AND timestamp < ?",
      )
      .bind(metricType, start, end)
      .first<{ n: number }>();
    if ((row?.n ?? 0) === 0) return date;
  }
  return null;
}
