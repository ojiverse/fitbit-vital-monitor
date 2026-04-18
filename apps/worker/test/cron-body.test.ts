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
  it("records weight/fat/BMI and then triggers the R2 archive sweep", async () => {
    const env = createFakeEnv({ USER_TIMEZONE: "UTC" });
    // Old intraday rows that should be swept to R2 by the archive step.
    await insertIntradaySamples(env.DB, [
      { timestamp: "2024-06-01T10:00:00.000Z", metricType: "heart_rate", value: 55 },
      { timestamp: "2024-06-02T10:00:00.000Z", metricType: "heart_rate", value: 60 },
      // A fresh row that should stay in place.
      { timestamp: "2024-06-15T02:00:00.000Z", metricType: "heart_rate", value: 70 },
    ]);

    stubFetchByUrl((url) => {
      if (url.includes("/body/log/weight/")) {
        return {
          body: {
            weight: [{ date: "2024-06-15", time: "07:30:00", weight: 69.4, bmi: 21.5, fat: 17.8 }],
          },
        };
      }
      return undefined;
    });

    await runBody(env);

    const weight = await selectDailyRange(env.DB, "weight", "2024-06-15", "2024-06-15");
    expect(weight[0]?.value).toBe(69.4);
    const bmi = await selectDailyRange(env.DB, "bmi", "2024-06-15", "2024-06-15");
    expect(bmi[0]?.value).toBe(21.5);
    const fat = await selectDailyRange(env.DB, "body_fat", "2024-06-15", "2024-06-15");
    expect(fat[0]?.value).toBe(17.8);

    // Old rows archived and deleted, fresh row preserved
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
  });

  it("skips weight writes when Fitbit returns an empty log", async () => {
    const env = createFakeEnv({ USER_TIMEZONE: "UTC" });
    stubFetchByUrl((url) => {
      if (url.includes("/body/log/weight/")) return { body: { weight: [] } };
      return undefined;
    });
    await runBody(env);
    const weight = await selectDailyRange(env.DB, "weight", "2024-06-15", "2024-06-15");
    expect(weight).toEqual([]);
  });
});
