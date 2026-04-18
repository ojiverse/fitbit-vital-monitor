import { describe, expect, it } from "vitest";
import {
  countDaily,
  deleteIntradayOlderThan,
  insertIntradaySamples,
  selectAllLatest,
  selectDailyRange,
  selectIntradayByDate,
  selectIntradayOlderThan,
  selectLatestDaily,
  upsertDaily,
} from "../src/db/vitals";
import { createFakeD1 } from "./helpers/fake-d1";

describe("db/vitals", () => {
  it("insertIntradaySamples is a no-op for an empty array", async () => {
    const db = createFakeD1();
    await insertIntradaySamples(db, []);
    expect(await countDaily(db)).toBe(0);
  });

  it("insertIntradaySamples bulk inserts and selectAllLatest returns the newest per metric", async () => {
    const db = createFakeD1();
    await insertIntradaySamples(db, [
      { timestamp: "2024-06-15T00:00:00.000Z", metricType: "heart_rate", value: 60 },
      { timestamp: "2024-06-15T00:05:00.000Z", metricType: "heart_rate", value: 65 },
      { timestamp: "2024-06-15T00:00:00.000Z", metricType: "steps", value: 100 },
    ]);
    const latest = await selectAllLatest(db);
    const hr = latest.find((r) => r.metricType === "heart_rate");
    expect(hr).toEqual({
      metricType: "heart_rate",
      timestamp: "2024-06-15T00:05:00.000Z",
      value: 65,
    });
    expect(latest.find((r) => r.metricType === "steps")?.value).toBe(100);
  });

  it("upsertDaily inserts then overwrites the same (date, metric_type)", async () => {
    const db = createFakeD1();
    await upsertDaily(db, "2024-06-15", "steps", 1000);
    await upsertDaily(db, "2024-06-15", "steps", 8500, { source: "retry" });
    const rows = await selectDailyRange(db, "steps", "2024-06-15", "2024-06-15");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.value).toBe(8500);
    expect(JSON.parse(rows[0]?.meta ?? "null")).toEqual({ source: "retry" });
  });

  it("upsertDaily preserves null meta when not supplied", async () => {
    const db = createFakeD1();
    await upsertDaily(db, "2024-06-15", "steps", 100);
    const rows = await selectDailyRange(db, "steps", "2024-06-15", "2024-06-15");
    expect(rows[0]?.meta).toBeNull();
  });

  it("selectLatestDaily returns one row per metric type at the newest date", async () => {
    const db = createFakeD1();
    await upsertDaily(db, "2024-06-14", "steps", 500);
    await upsertDaily(db, "2024-06-15", "steps", 1000);
    await upsertDaily(db, "2024-06-15", "weight", 70);
    const latest = await selectLatestDaily(db);
    const byMetric = Object.fromEntries(latest.map((r) => [r.metricType, r]));
    expect(byMetric.steps?.timestamp).toBe("2024-06-15");
    expect(byMetric.steps?.value).toBe(1000);
    expect(byMetric.weight?.value).toBe(70);
  });

  it("selectDailyRange filters to the requested inclusive range and orders ascending", async () => {
    const db = createFakeD1();
    await upsertDaily(db, "2024-06-10", "steps", 1);
    await upsertDaily(db, "2024-06-12", "steps", 2);
    await upsertDaily(db, "2024-06-15", "steps", 3);
    const rows = await selectDailyRange(db, "steps", "2024-06-11", "2024-06-14");
    expect(rows.map((r) => r.date)).toEqual(["2024-06-12"]);
  });

  it("selectIntradayByDate filters by the half-open timestamp range", async () => {
    const db = createFakeD1();
    await insertIntradaySamples(db, [
      { timestamp: "2024-06-14T23:59:59.999Z", metricType: "heart_rate", value: 55 },
      { timestamp: "2024-06-15T00:00:00.000Z", metricType: "heart_rate", value: 60 },
      { timestamp: "2024-06-15T12:00:00.000Z", metricType: "heart_rate", value: 72 },
      { timestamp: "2024-06-16T00:00:00.000Z", metricType: "heart_rate", value: 58 },
    ]);
    const rows = await selectIntradayByDate(
      db,
      "heart_rate",
      "2024-06-15T00:00:00.000Z",
      "2024-06-16T00:00:00.000Z",
    );
    expect(rows.map((r) => r.value)).toEqual([60, 72]);
  });

  it("selectIntradayOlderThan / deleteIntradayOlderThan move the retention cutoff correctly", async () => {
    const db = createFakeD1();
    await insertIntradaySamples(db, [
      { timestamp: "2024-06-01T00:00:00.000Z", metricType: "heart_rate", value: 10 },
      { timestamp: "2024-06-10T00:00:00.000Z", metricType: "heart_rate", value: 20 },
      { timestamp: "2024-06-15T00:00:00.000Z", metricType: "heart_rate", value: 30 },
    ]);
    const cutoff = "2024-06-12T00:00:00.000Z";
    const older = await selectIntradayOlderThan(db, cutoff);
    expect(older.map((r) => r.value)).toEqual([10, 20]);
    const changes = await deleteIntradayOlderThan(db, cutoff);
    expect(changes).toBe(2);
    const remaining = await selectIntradayByDate(
      db,
      "heart_rate",
      "2024-06-01T00:00:00.000Z",
      "2024-07-01T00:00:00.000Z",
    );
    expect(remaining.map((r) => r.value)).toEqual([30]);
  });
});
