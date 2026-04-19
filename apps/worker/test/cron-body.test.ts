import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runBody } from "../src/cron/body";
import { insertIntradaySamples, selectDailyRange, selectIntradayByDate } from "../src/db/vitals";
import { createFakeEnv } from "./helpers/fake-env";
import { stubFetchByUrl } from "./helpers/fetch-mock";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2024-06-15T03:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("runBody", () => {
  it("triggers the R2 archive sweep without making any Fitbit calls (weight is webhook-driven)", async () => {
    const env = createFakeEnv({ USER_TIMEZONE: "UTC" });
    await insertIntradaySamples(env.DB, [
      { timestamp: "2024-06-01T10:00:00.000Z", metricType: "heart_rate", value: 55 },
      { timestamp: "2024-06-02T10:00:00.000Z", metricType: "heart_rate", value: 60 },
      { timestamp: "2024-06-15T02:00:00.000Z", metricType: "heart_rate", value: 70 },
    ]);
    const spy = stubFetchByUrl(() => undefined);

    await runBody(env);

    // No Fitbit calls — body cron is now archive-only.
    expect(spy).not.toHaveBeenCalled();

    // Old rows archived and deleted, fresh row preserved.
    const remaining = await selectIntradayByDate(
      env.DB,
      "heart_rate",
      "2024-06-01T00:00:00.000Z",
      "2024-07-01T00:00:00.000Z",
    );
    expect(remaining.map((r) => r.value)).toEqual([70]);
    const archivedKeys = Array.from(env.ARCHIVE.store.keys()).sort();
    expect(archivedKeys).toEqual(["archive/2024-06-01.jsonl", "archive/2024-06-02.jsonl"]);
    expect(env.ARCHIVE.store.get("archive/2024-06-01.jsonl")?.body).toContain('"value":55');

    // No weight row should appear (no fetch occurred).
    const weight = await selectDailyRange(env.DB, "weight", "2024-06-15", "2024-06-15");
    expect(weight).toEqual([]);
  });
});
