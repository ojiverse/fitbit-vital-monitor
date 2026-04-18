import { addDays } from "./time";

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
