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
  it("writes heart rate intraday samples, resting heart rate, and rate-limit state", async () => {
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
      return undefined;
    });

    await runHighFrequency(env);

    const latestIntraday = await selectAllLatest(env.DB);
    const hr = latestIntraday.find((r) => r.metricType === "heart_rate");
    expect(hr?.value).toBe(62);
    expect(hr?.timestamp).toBe("2024-06-15T00:01:00.000Z");

    const restingRow = await env.DB.prepare(
      "SELECT value FROM vitals_daily WHERE metric_type = 'heart_rate_resting'",
    ).first<{ value: number }>();
    expect(restingRow?.value).toBe(58);

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
      return undefined;
    });
    await runHighFrequency(env);
    const restingRow = await env.DB.prepare(
      "SELECT value FROM vitals_daily WHERE metric_type = 'heart_rate_resting'",
    ).first<{ value: number }>();
    expect(restingRow).toBeNull();
  });

  it("does not invoke any non-heart-rate Fitbit endpoints (webhook-first ingestion)", async () => {
    const env = createFakeEnv({ USER_TIMEZONE: "UTC" });
    const spy = stubFetchByUrl((url) => {
      if (url.includes("/activities/heart/date/")) {
        return {
          body: {
            "activities-heart": [{ dateTime: "2024-06-15", value: {} }],
            "activities-heart-intraday": { dataset: [] },
          },
        };
      }
      return undefined;
    });
    await runHighFrequency(env);
    const urls = spy.mock.calls.map((c) => String(c[0]));
    // No activity summary, AZM, or any other endpoint should have been touched.
    expect(urls.some((u) => u.includes("/activities/active-zone-minutes/"))).toBe(false);
    expect(urls.some((u) => u.match(/\/activities\/date\//))).toBe(false);
    expect(urls.every((u) => u.includes("/activities/heart/date/"))).toBe(true);
  });
});
