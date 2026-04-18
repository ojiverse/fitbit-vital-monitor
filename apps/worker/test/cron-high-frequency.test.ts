import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runHighFrequency } from "../src/cron/high-frequency";
import { selectRateLimit } from "../src/db/rate-limit";
import { selectAllLatest } from "../src/db/vitals";
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

describe("runHighFrequency", () => {
  it("writes heart rate intraday, daily activity totals, AZM zones and rate-limit state", async () => {
    const env = createFakeEnv({ USER_TIMEZONE: "UTC" });
    stubFetchByUrl((url) => {
      if (url.includes("/activities/heart/date/")) {
        return {
          body: {
            "activities-heart": [{ dateTime: "2024-06-15", value: { restingHeartRate: 58 } }],
            "activities-heart-intraday": {
              dataset: [
                { time: "00:00:00", value: 60 },
                { time: "00:01:00", value: 62 },
              ],
            },
          },
        };
      }
      if (url.includes("/activities/active-zone-minutes/")) {
        return {
          body: {
            "activities-active-zone-minutes": [
              {
                dateTime: "2024-06-15",
                value: {
                  fatBurnActiveZoneMinutes: 10,
                  cardioActiveZoneMinutes: 5,
                  peakActiveZoneMinutes: 1,
                },
              },
            ],
          },
        };
      }
      if (url.includes("/activities/date/")) {
        return {
          body: {
            summary: {
              steps: 5400,
              caloriesOut: 1800,
              floors: 6,
              distances: [{ activity: "total", distance: 4.2 }],
            },
          },
        };
      }
      return undefined;
    });

    await runHighFrequency(env);

    const latestIntraday = await selectAllLatest(env.DB);
    const hr = latestIntraday.find((r) => r.metricType === "heart_rate");
    expect(hr?.value).toBe(62);
    expect(hr?.timestamp).toBe("2024-06-15T00:01:00.000Z");

    const daily = await env.DB.prepare(
      "SELECT metric_type, value FROM vitals_daily ORDER BY metric_type",
    ).all<{ metric_type: string; value: number }>();
    const byMetric = Object.fromEntries(daily.results.map((r) => [r.metric_type, r.value]));
    expect(byMetric.heart_rate_resting).toBe(58);
    expect(byMetric.steps).toBe(5400);
    expect(byMetric.calories).toBe(1800);
    expect(byMetric.floors).toBe(6);
    expect(byMetric.distance).toBe(4200);
    expect(byMetric.azm_fat_burn).toBe(10);
    expect(byMetric.azm_cardio).toBe(5);
    expect(byMetric.azm_peak).toBe(1);
    expect(byMetric.azm_total).toBe(16);

    const rl = await selectRateLimit(env.DB);
    expect(rl?.limitTotal).toBe(150);
    expect(rl?.remaining).toBe(140);
  });

  it("omits resting heart rate when Fitbit does not report it", async () => {
    const env = createFakeEnv({ USER_TIMEZONE: "UTC" });
    stubFetchByUrl((url) => {
      if (url.includes("/activities/heart/date/")) {
        return {
          body: {
            "activities-heart": [{ dateTime: "2024-06-15", value: {} }],
            "activities-heart-intraday": { dataset: [] },
          },
        };
      }
      if (url.includes("/activities/active-zone-minutes/")) {
        return { body: { "activities-active-zone-minutes": [] } };
      }
      if (url.includes("/activities/date/")) {
        return {
          body: { summary: { steps: 0, caloriesOut: 0, floors: 0, distances: [] } },
        };
      }
      return undefined;
    });
    await runHighFrequency(env);
    const restingRow = await env.DB.prepare(
      "SELECT value FROM vitals_daily WHERE metric_type = 'heart_rate_resting'",
    ).first<{ value: number }>();
    expect(restingRow).toBeNull();
  });
});
