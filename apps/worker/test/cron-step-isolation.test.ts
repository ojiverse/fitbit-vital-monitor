import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runBody } from "../src/cron/body";
import { runDailyFallback } from "../src/cron/daily-fallback";
import { runHighFrequency } from "../src/cron/high-frequency";
import { runSteps } from "../src/cron/run-steps";
import { insertIntradaySamples, selectDailyRange } from "../src/db/vitals";
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

describe("runSteps", () => {
  it("runs every step even when one throws", async () => {
    const log: string[] = [];
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const results = await runSteps("test", [
      { name: "a", run: async () => void log.push("a") },
      {
        name: "b",
        run: async () => {
          log.push("b-start");
          throw new Error("boom");
        },
      },
      { name: "c", run: async () => void log.push("c") },
    ]);

    expect(log).toEqual(["a", "b-start", "c"]);
    expect(results).toEqual([
      { name: "a", ok: true },
      { name: "b", ok: false, error: "boom" },
      { name: "c", ok: true },
    ]);
    expect(errorSpy).toHaveBeenCalledWith("[cron:test] step b failed: boom");
  });

  it("throws when every step fails so the scheduled handler marks the run as failed", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      runSteps("test", [
        {
          name: "a",
          run: async () => {
            throw new Error("x");
          },
        },
        {
          name: "b",
          run: async () => {
            throw new Error("y");
          },
        },
      ]),
    ).rejects.toThrow(/all 2 steps failed.*a\(x\).*b\(y\)/);
  });
});

describe("runHighFrequency step isolation", () => {
  it("still records same-day heart rate intraday when the backfill day fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const env = createFakeEnv({ USER_TIMEZONE: "UTC" });
    stubFetchByUrl((url) => {
      const date = url.match(/\/date\/(\d{4}-\d{2}-\d{2})/)?.[1] ?? "";
      if (url.includes("/activities/heart/date/")) {
        if (date === "2024-06-15") {
          return {
            body: {
              "activities-heart": [{ dateTime: "2024-06-15", value: { restingHeartRate: 58 } }],
              "activities-heart-intraday": { dataset: [{ time: "00:00:00", value: 60 }] },
            },
          };
        }
        // Backfill day fails (no stub match → 500)
        return undefined;
      }
      return undefined;
    });

    await runHighFrequency(env);

    const resting = await selectDailyRange(
      env.DB,
      "heart_rate_resting",
      "2024-06-15",
      "2024-06-15",
    );
    expect(resting[0]?.value).toBe(58);
  });

  it("throws when every heart rate fetch fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const env = createFakeEnv({ USER_TIMEZONE: "UTC" });
    stubFetchByUrl(() => undefined);
    // 1 today step + 1 backfill step (empty DB → some day in 7-day window is missing).
    await expect(runHighFrequency(env)).rejects.toThrow(/all 2 steps failed/);
  });
});

describe("runBody", () => {
  it("archive sweep runs as the sole step (weight removed)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const env = createFakeEnv({ USER_TIMEZONE: "UTC" });
    await insertIntradaySamples(env.DB, [
      { timestamp: "2024-06-01T10:00:00.000Z", metricType: "heart_rate", value: 55 },
    ]);
    stubFetchByUrl(() => undefined);

    await runBody(env);

    const archivedKeys = Array.from(env.ARCHIVE.store.keys());
    expect(archivedKeys).toEqual(["archive/2024-06-01.jsonl"]);
  });
});

describe("runDailyFallback step isolation", () => {
  it("records HRV/skin/cardio for yesterday even when the sleep endpoint fails, and still backfills", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const env = createFakeEnv({ USER_TIMEZONE: "UTC" });

    stubFetchByUrl((url) => {
      const date = url.match(/\/date\/(\d{4}-\d{2}-\d{2})/)?.[1] ?? "";
      if (url.includes("/sleep/date/")) {
        // Yesterday (2024-06-14): fail. Backfill day: succeed with empty payload.
        if (date === "2024-06-14") return undefined;
        return { body: { sleep: [] } };
      }
      if (url.includes("/hrv/")) {
        return { body: { hrv: [{ dateTime: date, value: { dailyRmssd: 34, deepRmssd: 40 } }] } };
      }
      if (url.includes("/temp/skin/")) {
        return { body: { tempSkin: [{ dateTime: date, value: { nightlyRelative: -0.1 } }] } };
      }
      if (url.includes("/cardioscore/")) {
        return { body: { cardioScore: [{ dateTime: date, value: { vo2Max: "38-40" } }] } };
      }
      if (url.includes("/br/")) {
        return { body: { br: [{ dateTime: date, value: { breathingRate: 13.8 } }] } };
      }
      if (url.includes("/spo2/")) {
        return { body: { dateTime: date, value: { avg: 96, min: 92, max: 99 } } };
      }
      if (url.includes("/activities/date/")) {
        return { body: { summary: { steps: 0, caloriesOut: 0, floors: 0, distances: [] } } };
      }
      if (url.includes("/active-zone-minutes/")) {
        return { body: { "activities-active-zone-minutes": [] } };
      }
      if (url.includes("/body/log/weight/")) return { body: { weight: [] } };
      return undefined;
    });

    await runDailyFallback(env);

    // Sleep failed for yesterday → no sleep_duration for 2024-06-14.
    const sleepYesterday = await selectDailyRange(
      env.DB,
      "sleep_duration",
      "2024-06-14",
      "2024-06-14",
    );
    expect(sleepYesterday).toEqual([]);

    // But the rest of the wake-up bundle for yesterday still landed.
    const hrvYesterday = await selectDailyRange(env.DB, "hrv_rmssd", "2024-06-14", "2024-06-14");
    expect(hrvYesterday[0]?.value).toBe(34);
    const skinYesterday = await selectDailyRange(
      env.DB,
      "skin_temperature_relative",
      "2024-06-14",
      "2024-06-14",
    );
    expect(skinYesterday[0]?.value).toBe(-0.1);
    const cardioYesterday = await selectDailyRange(
      env.DB,
      "cardio_score",
      "2024-06-14",
      "2024-06-14",
    );
    expect(cardioYesterday[0]?.value).toBe(39);

    // And backfill day (oldest missing = 2024-05-16 for a 30-day window) still ran through HRV.
    const hrvBackfill = await selectDailyRange(env.DB, "hrv_rmssd", "2024-05-16", "2024-05-16");
    expect(hrvBackfill[0]?.value).toBe(34);
  });
});
