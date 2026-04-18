import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runHighFrequency } from "../src/cron/high-frequency";
import { insertIntradaySamples, selectIntradayByDate } from "../src/db/vitals";
import { findOldestMissingIntradayDay } from "../src/util/backfill";
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

describe("findOldestMissingIntradayDay", () => {
  it("returns the oldest day in the window with zero samples (UTC)", async () => {
    const env = createFakeEnv({ USER_TIMEZONE: "UTC" });
    // Seed only 2024-06-13 and 2024-06-11 with heart_rate samples.
    await insertIntradaySamples(env.DB, [
      { timestamp: "2024-06-13T10:00:00.000Z", metricType: "heart_rate", value: 70 },
      { timestamp: "2024-06-11T10:00:00.000Z", metricType: "heart_rate", value: 68 },
    ]);

    // Today = 2024-06-15, lookback = 7 → checks 2024-06-08 through 2024-06-14.
    // Oldest missing should be 2024-06-08 (no samples at all).
    const missing = await findOldestMissingIntradayDay(
      env.DB,
      "heart_rate",
      7,
      "2024-06-15",
      "UTC",
    );
    expect(missing).toBe("2024-06-08");
  });

  it("returns null when every day in the window has at least one sample", async () => {
    const env = createFakeEnv({ USER_TIMEZONE: "UTC" });
    const samples = [];
    for (let i = 1; i <= 7; i++) {
      const date = new Date("2024-06-15T00:00:00.000Z");
      date.setUTCDate(date.getUTCDate() - i);
      samples.push({
        timestamp: `${date.toISOString().slice(0, 10)}T00:00:00.000Z`,
        metricType: "heart_rate" as const,
        value: 60,
      });
    }
    await insertIntradaySamples(env.DB, samples);

    const missing = await findOldestMissingIntradayDay(
      env.DB,
      "heart_rate",
      7,
      "2024-06-15",
      "UTC",
    );
    expect(missing).toBeNull();
  });

  it("uses timezone-aware day boundaries so JST midnight maps to the correct UTC range", async () => {
    const env = createFakeEnv({ USER_TIMEZONE: "Asia/Tokyo" });
    // Insert one sample at 2024-06-14T15:30:00Z = 2024-06-15 00:30 JST (today).
    // Insert one sample at 2024-06-13T16:00:00Z = 2024-06-14 01:00 JST (yesterday).
    // Everything else in the 7-day JST window should be empty.
    await insertIntradaySamples(env.DB, [
      { timestamp: "2024-06-14T15:30:00.000Z", metricType: "heart_rate", value: 60 },
      { timestamp: "2024-06-13T16:00:00.000Z", metricType: "heart_rate", value: 62 },
    ]);

    // "today" in JST is 2024-06-15 (since the seed clock is 12:00 JST).
    const missing = await findOldestMissingIntradayDay(
      env.DB,
      "heart_rate",
      7,
      "2024-06-15",
      "Asia/Tokyo",
    );
    // Yesterday (2024-06-14 JST) has the 01:00 JST sample, so the oldest truly empty
    // day within [2024-06-08, 2024-06-14] is 2024-06-08.
    expect(missing).toBe("2024-06-08");
  });
});

describe("runHighFrequency intraday backfill", () => {
  it("fetches one historical day's heart rate intraday when a gap exists in the 7-day window", async () => {
    const env = createFakeEnv({ USER_TIMEZONE: "UTC" });
    // Seed 2024-06-13 only; 2024-06-08..2024-06-12 and 2024-06-14 are missing.
    // Oldest missing in the window should be 2024-06-08.
    await insertIntradaySamples(env.DB, [
      { timestamp: "2024-06-13T10:00:00.000Z", metricType: "heart_rate", value: 70 },
    ]);

    const calls: string[] = [];
    stubFetchByUrl((url) => {
      const date = url.match(/\/heart\/date\/(\d{4}-\d{2}-\d{2})/)?.[1];
      if (url.includes("/activities/heart/date/") && date) {
        calls.push(date);
        return {
          body: {
            "activities-heart": [{ dateTime: date, value: { restingHeartRate: 58 } }],
            "activities-heart-intraday": {
              dataset: [
                { time: "08:00:00", value: 61 },
                { time: "08:01:00", value: 62 },
              ],
            },
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

    // Heart-rate endpoint called twice: once for today, once for the backfill day.
    expect(calls).toContain("2024-06-15");
    expect(calls).toContain("2024-06-08");
    expect(calls).toHaveLength(2);

    // Backfill day now has samples.
    const backfill = await selectIntradayByDate(
      env.DB,
      "heart_rate",
      "2024-06-08T00:00:00.000Z",
      "2024-06-09T00:00:00.000Z",
    );
    expect(backfill).toHaveLength(2);
    expect(backfill[0]?.value).toBe(61);
  });

  it("does not fetch a backfill day when the full 7-day window is covered", async () => {
    const env = createFakeEnv({ USER_TIMEZONE: "UTC" });
    // Seed every day 2024-06-08 .. 2024-06-14 with one sample.
    const samples = [];
    for (let i = 1; i <= 7; i++) {
      const d = new Date("2024-06-15T00:00:00.000Z");
      d.setUTCDate(d.getUTCDate() - i);
      samples.push({
        timestamp: `${d.toISOString().slice(0, 10)}T12:00:00.000Z`,
        metricType: "heart_rate" as const,
        value: 60,
      });
    }
    await insertIntradaySamples(env.DB, samples);

    const calls: string[] = [];
    stubFetchByUrl((url) => {
      const date = url.match(/\/heart\/date\/(\d{4}-\d{2}-\d{2})/)?.[1];
      if (url.includes("/activities/heart/date/") && date) {
        calls.push(date);
        return {
          body: {
            "activities-heart": [{ dateTime: date, value: {} }],
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

    // Only today's call — no backfill.
    expect(calls).toEqual(["2024-06-15"]);
  });

  it("still runs today's steps when the backfill endpoint fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const env = createFakeEnv({ USER_TIMEZONE: "UTC" });
    // Ensure a backfill day is picked.
    await insertIntradaySamples(env.DB, []);

    stubFetchByUrl((url) => {
      const date = url.match(/\/heart\/date\/(\d{4}-\d{2}-\d{2})/)?.[1];
      if (url.includes("/activities/heart/date/")) {
        // Fail for the backfill day, succeed for today.
        if (date && date !== "2024-06-15") return undefined;
        return {
          body: {
            "activities-heart": [{ dateTime: date, value: { restingHeartRate: 58 } }],
            "activities-heart-intraday": {
              dataset: [{ time: "00:00:00", value: 60 }],
            },
          },
        };
      }
      if (url.includes("/activities/active-zone-minutes/")) {
        return { body: { "activities-active-zone-minutes": [] } };
      }
      if (url.includes("/activities/date/")) {
        return {
          body: { summary: { steps: 5000, caloriesOut: 1800, floors: 4, distances: [] } },
        };
      }
      return undefined;
    });

    await runHighFrequency(env);

    // Today's intraday landed despite backfill failing.
    const today = await selectIntradayByDate(
      env.DB,
      "heart_rate",
      "2024-06-15T00:00:00.000Z",
      "2024-06-16T00:00:00.000Z",
    );
    expect(today).toHaveLength(1);
    expect(today[0]?.value).toBe(60);
  });
});
