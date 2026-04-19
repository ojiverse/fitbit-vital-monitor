import type { MetricType } from "../types";

export type IntradaySample = {
  readonly timestamp: string;
  readonly metricType: MetricType;
  readonly value: number;
};

export type LatestSample = {
  readonly metricType: string;
  readonly timestamp: string;
  readonly value: number;
  readonly meta?: string | null;
};

export type DailyPoint = {
  readonly date: string;
  readonly metricType: string;
  readonly value: number;
  readonly meta: string | null;
};

export type IntradayPoint = {
  readonly timestamp: string;
  readonly value: number;
};

export async function insertIntradaySamples(
  db: D1Database,
  samples: ReadonlyArray<IntradaySample>,
): Promise<void> {
  if (samples.length === 0) return;
  // `INSERT OR IGNORE` because the high-frequency cron refetches the whole
  // day's intraday window every tick; the UNIQUE(metric_type, timestamp)
  // index added in migration 0002 makes re-inserts a no-op.
  const stmt = db.prepare(
    "INSERT OR IGNORE INTO vitals (timestamp, metric_type, value) VALUES (?, ?, ?)",
  );
  await db.batch(samples.map((s) => stmt.bind(s.timestamp, s.metricType, s.value)));
}

export async function upsertDaily(
  db: D1Database,
  date: string,
  metricType: MetricType,
  value: number,
  meta?: unknown,
): Promise<void> {
  const metaJson = meta === undefined ? null : JSON.stringify(meta);
  await db
    .prepare(
      `INSERT INTO vitals_daily (date, metric_type, value, meta)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(date, metric_type) DO UPDATE SET
         value = excluded.value,
         meta = excluded.meta`,
    )
    .bind(date, metricType, value, metaJson)
    .run();
}

export async function selectAllLatest(db: D1Database): Promise<ReadonlyArray<LatestSample>> {
  const rows = await db
    .prepare(
      `SELECT metric_type, timestamp, value FROM (
         SELECT metric_type, timestamp, value,
                ROW_NUMBER() OVER (PARTITION BY metric_type ORDER BY timestamp DESC) AS rn
         FROM vitals
       ) WHERE rn = 1`,
    )
    .all<{ metric_type: string; timestamp: string; value: number }>();
  return rows.results.map((r) => ({
    metricType: r.metric_type,
    timestamp: r.timestamp,
    value: r.value,
  }));
}

export async function selectLatestDaily(db: D1Database): Promise<ReadonlyArray<LatestSample>> {
  const rows = await db
    .prepare(
      `SELECT metric_type, date AS timestamp, value, meta FROM (
         SELECT metric_type, date, value, meta,
                ROW_NUMBER() OVER (PARTITION BY metric_type ORDER BY date DESC) AS rn
         FROM vitals_daily
       ) WHERE rn = 1`,
    )
    .all<{ metric_type: string; timestamp: string; value: number; meta: string | null }>();
  return rows.results.map((r) => ({
    metricType: r.metric_type,
    timestamp: r.timestamp,
    value: r.value,
    meta: r.meta,
  }));
}

export async function selectDailyRange(
  db: D1Database,
  metricType: string,
  from: string,
  to: string,
): Promise<ReadonlyArray<DailyPoint>> {
  const rows = await db
    .prepare(
      `SELECT date, metric_type, value, meta
       FROM vitals_daily
       WHERE metric_type = ? AND date BETWEEN ? AND ?
       ORDER BY date ASC`,
    )
    .bind(metricType, from, to)
    .all<{ date: string; metric_type: string; value: number; meta: string | null }>();
  return rows.results.map((r) => ({
    date: r.date,
    metricType: r.metric_type,
    value: r.value,
    meta: r.meta,
  }));
}

export async function selectIntradayByDate(
  db: D1Database,
  metricType: string,
  dateFrom: string,
  dateTo: string,
): Promise<ReadonlyArray<IntradayPoint>> {
  const rows = await db
    .prepare(
      `SELECT timestamp, value
       FROM vitals
       WHERE metric_type = ? AND timestamp >= ? AND timestamp < ?
       ORDER BY timestamp ASC`,
    )
    .bind(metricType, dateFrom, dateTo)
    .all<{ timestamp: string; value: number }>();
  return rows.results.map((r) => ({ timestamp: r.timestamp, value: r.value }));
}

export async function countDaily(db: D1Database): Promise<number> {
  const row = await db.prepare("SELECT COUNT(*) AS n FROM vitals_daily").first<{ n: number }>();
  return row?.n ?? 0;
}

export async function selectIntradayOlderThan(
  db: D1Database,
  cutoffIso: string,
): Promise<ReadonlyArray<{ timestamp: string; metricType: string; value: number }>> {
  const rows = await db
    .prepare(
      `SELECT timestamp, metric_type, value
       FROM vitals
       WHERE timestamp < ?
       ORDER BY timestamp ASC`,
    )
    .bind(cutoffIso)
    .all<{ timestamp: string; metric_type: string; value: number }>();
  return rows.results.map((r) => ({
    timestamp: r.timestamp,
    metricType: r.metric_type,
    value: r.value,
  }));
}

export async function deleteIntradayOlderThan(db: D1Database, cutoffIso: string): Promise<number> {
  const result = await db.prepare("DELETE FROM vitals WHERE timestamp < ?").bind(cutoffIso).run();
  return result.meta.changes ?? 0;
}
