import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runArchive } from "../src/cron/archive";
import { insertIntradaySamples, selectIntradayByDate } from "../src/db/vitals";
import { createFakeEnv } from "./helpers/fake-env";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2024-06-15T12:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("runArchive", () => {
  it("is a no-op when nothing is older than the 7 day retention window", async () => {
    const env = createFakeEnv();
    await insertIntradaySamples(env.DB, [
      { timestamp: "2024-06-14T10:00:00.000Z", metricType: "heart_rate", value: 70 },
    ]);
    await runArchive(env);
    expect(env.ARCHIVE.store.size).toBe(0);
    const rows = await selectIntradayByDate(
      env.DB,
      "heart_rate",
      "2024-06-01T00:00:00.000Z",
      "2024-07-01T00:00:00.000Z",
    );
    expect(rows).toHaveLength(1);
  });

  it("groups expired rows by day into JSONL objects and deletes them from D1", async () => {
    const env = createFakeEnv();
    await insertIntradaySamples(env.DB, [
      { timestamp: "2024-06-05T10:00:00.000Z", metricType: "heart_rate", value: 61 },
      { timestamp: "2024-06-05T10:01:00.000Z", metricType: "heart_rate", value: 62 },
      { timestamp: "2024-06-06T10:00:00.000Z", metricType: "steps", value: 5000 },
      { timestamp: "2024-06-14T10:00:00.000Z", metricType: "heart_rate", value: 70 },
    ]);

    await runArchive(env);

    const keys = Array.from(env.ARCHIVE.store.keys()).sort();
    expect(keys).toEqual(["archive/2024-06-05.jsonl", "archive/2024-06-06.jsonl"]);

    const june5 = env.ARCHIVE.store.get("archive/2024-06-05.jsonl")?.body ?? "";
    const june5Lines = june5.trim().split("\n");
    expect(june5Lines).toHaveLength(2);
    for (const line of june5Lines) {
      const parsed = JSON.parse(line) as { metricType: string; value: number };
      expect(parsed.metricType).toBe("heart_rate");
      expect([61, 62]).toContain(parsed.value);
    }

    const remaining = await selectIntradayByDate(
      env.DB,
      "heart_rate",
      "2024-06-01T00:00:00.000Z",
      "2024-07-01T00:00:00.000Z",
    );
    expect(remaining.map((r) => r.value)).toEqual([70]);
  });

  it("appends to an existing archive object without losing previous content", async () => {
    const env = createFakeEnv();
    await env.ARCHIVE.put(
      "archive/2024-06-05.jsonl",
      `${JSON.stringify({ timestamp: "2024-06-05T09:00:00.000Z", metricType: "heart_rate", value: 50 })}\n`,
    );
    await insertIntradaySamples(env.DB, [
      { timestamp: "2024-06-05T10:00:00.000Z", metricType: "heart_rate", value: 61 },
    ]);

    await runArchive(env);

    const body = env.ARCHIVE.store.get("archive/2024-06-05.jsonl")?.body ?? "";
    const lines = body.trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('"value":50');
    expect(lines[1]).toContain('"value":61');
  });
});
