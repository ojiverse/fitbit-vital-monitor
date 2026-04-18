import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runPostWake } from "../src/cron/post-wake";
import { upsertDaily } from "../src/db/vitals";
import { createFakeEnv } from "./helpers/fake-env";
import { stubFetchByUrl } from "./helpers/fetch-mock";

beforeEach(() => {
  vi.useFakeTimers();
  // 2024-06-15 03:00 UTC → "today" = 2024-06-15 in UTC, "yesterday" = 2024-06-14
  vi.setSystemTime(new Date("2024-06-15T03:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("runPostWake", () => {
  it("stores sleep, HRV, skin temp and cardio score for yesterday and backfills one older day", async () => {
    const env = createFakeEnv({ USER_TIMEZONE: "UTC" });
    const seenDates = new Set<string>();
    stubFetchByUrl((url) => {
      const match = url.match(/\/date\/(\d{4}-\d{2}-\d{2})/);
      const date = match?.[1] ?? "";
      seenDates.add(date);
      if (url.includes("/sleep/date/")) {
        return {
          body: {
            sleep: [
              {
                isMainSleep: true,
                duration: 28800000,
                efficiency: 90,
                startTime: `${date}T23:00:00.000`,
                endTime: `${date}T07:00:00.000`,
                levels: {
                  summary: {
                    deep: { minutes: 60 },
                    light: { minutes: 200 },
                    rem: { minutes: 90 },
                    wake: { minutes: 30 },
                  },
                },
              },
            ],
          },
        };
      }
      if (url.includes("/hrv/")) {
        return {
          body: { hrv: [{ dateTime: date, value: { dailyRmssd: 34, deepRmssd: 40 } }] },
        };
      }
      if (url.includes("/temp/skin/")) {
        return {
          body: { tempSkin: [{ dateTime: date, value: { nightlyRelative: -0.2 } }] },
        };
      }
      if (url.includes("/cardioscore/")) {
        return { body: { cardioScore: [{ dateTime: date, value: { vo2Max: "38-40" } }] } };
      }
      return undefined;
    });

    await runPostWake(env);

    // Expect rows for 2024-06-14 (yesterday). Also expect a backfill day (oldest missing = 2024-05-16 for 30-day window).
    const sleepRows = await env.DB.prepare(
      "SELECT date FROM vitals_daily WHERE metric_type = 'sleep_duration' ORDER BY date",
    ).all<{ date: string }>();
    const dates = sleepRows.results.map((r) => r.date);
    expect(dates).toContain("2024-06-14");
    expect(dates).toContain("2024-05-16");

    const yesterdaySleep = await env.DB.prepare(
      "SELECT value, meta FROM vitals_daily WHERE metric_type = 'sleep_duration' AND date = '2024-06-14'",
    ).first<{ value: number; meta: string }>();
    expect(yesterdaySleep?.value).toBe(28800);
    const meta = JSON.parse(yesterdaySleep?.meta ?? "null");
    expect(meta.stages).toEqual({ deep: 3600, light: 12000, rem: 5400, wake: 1800 });

    const hrv = await env.DB.prepare(
      "SELECT value FROM vitals_daily WHERE metric_type = 'hrv_rmssd' AND date = '2024-06-14'",
    ).first<{ value: number }>();
    expect(hrv?.value).toBe(34);

    const cardio = await env.DB.prepare(
      "SELECT value FROM vitals_daily WHERE metric_type = 'cardio_score' AND date = '2024-06-14'",
    ).first<{ value: number }>();
    expect(cardio?.value).toBe(39);
  });

  it("skips backfill when all 30 past days are already present", async () => {
    const env = createFakeEnv({ USER_TIMEZONE: "UTC" });
    for (let i = 1; i <= 30; i++) {
      const d = new Date("2024-06-15T00:00:00.000Z");
      d.setUTCDate(d.getUTCDate() - i);
      await upsertDaily(env.DB, d.toISOString().slice(0, 10), "sleep_duration", 3600);
    }
    const fetchSpy = stubFetchByUrl((url) => {
      if (url.includes("/sleep/date/")) return { body: { sleep: [] } };
      if (url.includes("/hrv/")) return { body: { hrv: [] } };
      if (url.includes("/temp/skin/")) return { body: { tempSkin: [] } };
      if (url.includes("/cardioscore/")) return { body: { cardioScore: [] } };
      return undefined;
    });

    await runPostWake(env);

    const distinctDates = new Set(
      fetchSpy.mock.calls.map((c) => {
        const url = c[0] as string;
        return url.match(/\/date\/(\d{4}-\d{2}-\d{2})/)?.[1];
      }),
    );
    // Only yesterday should have been requested (1 distinct date)
    expect(distinctDates).toEqual(new Set(["2024-06-14"]));
  });
});
