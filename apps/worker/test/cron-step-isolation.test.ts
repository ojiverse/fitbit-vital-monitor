import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runBody } from "../src/cron/body";
import { runHighFrequency } from "../src/cron/high-frequency";
import { runPostWake } from "../src/cron/post-wake";
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
  it("still records heart rate and activity when AZM returns 403", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const env = createFakeEnv({ USER_TIMEZONE: "UTC" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.includes("/activities/heart/date/")) {
          return new Response(
            JSON.stringify({
              "activities-heart": [{ dateTime: "2024-06-15", value: { restingHeartRate: 58 } }],
              "activities-heart-intraday": { dataset: [{ time: "00:00:00", value: 60 }] },
            }),
            { status: 200, headers: rateLimitHeaders() },
          );
        }
        if (url.includes("/activities/active-zone-minutes/")) {
          return new Response(
            JSON.stringify({ errors: [{ errorType: "insufficient_permissions" }] }),
            { status: 403, headers: rateLimitHeaders() },
          );
        }
        if (url.includes("/activities/date/")) {
          return new Response(
            JSON.stringify({
              summary: {
                steps: 1234,
                caloriesOut: 1500,
                floors: 3,
                distances: [{ activity: "total", distance: 1.2 }],
              },
            }),
            { status: 200, headers: rateLimitHeaders() },
          );
        }
        return new Response(`unexpected ${url}`, { status: 500 });
      }),
    );

    await runHighFrequency(env);

    const steps = await selectDailyRange(env.DB, "steps", "2024-06-15", "2024-06-15");
    expect(steps[0]?.value).toBe(1234);
    const resting = await selectDailyRange(
      env.DB,
      "heart_rate_resting",
      "2024-06-15",
      "2024-06-15",
    );
    expect(resting[0]?.value).toBe(58);
    const azm = await selectDailyRange(env.DB, "azm_total", "2024-06-15", "2024-06-15");
    expect(azm).toEqual([]);
  });

  it("throws when every Fitbit endpoint fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const env = createFakeEnv({ USER_TIMEZONE: "UTC" });
    stubFetchByUrl(() => undefined); // every call → 500 via fetch-mock default

    await expect(runHighFrequency(env)).rejects.toThrow(/all 3 steps failed/);
  });
});

describe("runBody step isolation", () => {
  it("still runs the R2 archive sweep when the weight endpoint fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const env = createFakeEnv({ USER_TIMEZONE: "UTC" });
    // Seed an old intraday row so the archive step has something to sweep.
    await insertIntradaySamples(env.DB, [
      { timestamp: "2024-06-01T10:00:00.000Z", metricType: "heart_rate", value: 55 },
    ]);

    stubFetchByUrl((url) => {
      if (url.includes("/body/log/weight/")) {
        // Simulate a Fitbit 5xx for weight.
        return undefined;
      }
      return undefined;
    });

    await runBody(env);

    // weight step failed → no weight row
    const weight = await selectDailyRange(env.DB, "weight", "2024-06-15", "2024-06-15");
    expect(weight).toEqual([]);
    // archive step still ran → old intraday row moved to R2 and deleted
    const archivedKeys = Array.from(env.ARCHIVE.store.keys());
    expect(archivedKeys).toEqual(["archive/2024-06-01.jsonl"]);
  });
});

describe("runPostWake step isolation", () => {
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
      return undefined;
    });

    await runPostWake(env);

    // Sleep failed for yesterday → no sleep_duration for 2024-06-14.
    const sleepYesterday = await selectDailyRange(
      env.DB,
      "sleep_duration",
      "2024-06-14",
      "2024-06-14",
    );
    expect(sleepYesterday).toEqual([]);

    // But the other three endpoints for yesterday still landed.
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

function rateLimitHeaders(): Record<string, string> {
  return {
    "fitbit-rate-limit-limit": "150",
    "fitbit-rate-limit-remaining": "140",
    "fitbit-rate-limit-reset": "1200",
  };
}
