import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runDailyFallback } from "../src/cron/daily-fallback";
import { selectDailyRange, upsertDaily } from "../src/db/vitals";
import { createFakeEnv } from "./helpers/fake-env";
import { stubFetchByUrl } from "./helpers/fetch-mock";

beforeEach(() => {
  vi.useFakeTimers();
  // 2024-06-15 03:00 UTC → today = 2024-06-15, yesterday = 2024-06-14 (UTC)
  vi.setSystemTime(new Date("2024-06-15T03:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("runDailyFallback", () => {
  it("re-fetches the wake-up bundle for yesterday plus today's activity/AZM/weight as webhook miss insurance", async () => {
    const env = createFakeEnv({ USER_TIMEZONE: "UTC" });
    const seenUrls: string[] = [];
    stubFetchByUrl((url) => {
      seenUrls.push(url);
      const date = url.match(/\/date\/(\d{4}-\d{2}-\d{2})/)?.[1] ?? "";
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
        return { body: { hrv: [{ dateTime: date, value: { dailyRmssd: 34, deepRmssd: 40 } }] } };
      }
      if (url.includes("/temp/skin/")) {
        return { body: { tempSkin: [{ dateTime: date, value: { nightlyRelative: -0.2 } }] } };
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
        return {
          body: {
            summary: {
              steps: 9001,
              caloriesOut: 2200,
              floors: 11,
              distances: [{ activity: "total", distance: 7.1 }],
            },
          },
        };
      }
      if (url.includes("/active-zone-minutes/")) {
        return {
          body: {
            "activities-active-zone-minutes": [
              {
                dateTime: date,
                value: {
                  fatBurnActiveZoneMinutes: 12,
                  cardioActiveZoneMinutes: 4,
                  activeZoneMinutes: 20,
                },
              },
            ],
          },
        };
      }
      if (url.includes("/body/log/weight/")) {
        return { body: { weight: [{ date, weight: 70.0, bmi: 21.4, fat: 18.0 }] } };
      }
      return undefined;
    });

    await runDailyFallback(env);

    // Yesterday-targeted fetches (sleep + 5 wake-up confirmed)
    for (const path of [
      "/sleep/date/2024-06-14",
      "/hrv/date/2024-06-14",
      "/temp/skin/date/2024-06-14",
      "/cardioscore/date/2024-06-14",
      "/br/date/2024-06-14",
      "/spo2/date/2024-06-14",
    ]) {
      expect(seenUrls.some((u) => u.includes(path))).toBe(true);
    }
    // Today-targeted fetches (activity + AZM + weight)
    for (const path of [
      "/activities/date/2024-06-15",
      "/activities/active-zone-minutes/date/2024-06-15",
      "/body/log/weight/date/2024-06-15",
    ]) {
      expect(seenUrls.some((u) => u.includes(path))).toBe(true);
    }

    // Spot-check D1 writes.
    const sleep = await selectDailyRange(env.DB, "sleep_duration", "2024-06-14", "2024-06-14");
    expect(sleep[0]?.value).toBe(28800);
    const br = await selectDailyRange(env.DB, "breathing_rate", "2024-06-14", "2024-06-14");
    expect(br[0]?.value).toBe(13.8);
    const spo2 = await selectDailyRange(env.DB, "spo2", "2024-06-14", "2024-06-14");
    expect(spo2[0]?.value).toBe(96);
    const steps = await selectDailyRange(env.DB, "steps", "2024-06-15", "2024-06-15");
    expect(steps[0]?.value).toBe(9001);
    const weight = await selectDailyRange(env.DB, "weight", "2024-06-15", "2024-06-15");
    expect(weight[0]?.value).toBe(70.0);
  });

  it("backfills the oldest missing sleep day in the 30-day window", async () => {
    const env = createFakeEnv({ USER_TIMEZONE: "UTC" });
    const seenDates = new Set<string>();
    stubFetchByUrl((url) => {
      const m = url.match(/\/date\/(\d{4}-\d{2}-\d{2})/);
      if (m?.[1]) seenDates.add(m[1]);
      if (url.includes("/sleep/date/")) {
        return {
          body: {
            sleep: [
              {
                isMainSleep: true,
                duration: 25200000,
                efficiency: 88,
                startTime: "2024-05-16T22:30:00.000",
                endTime: "2024-05-17T06:30:00.000",
                levels: { summary: {} },
              },
            ],
          },
        };
      }
      if (url.includes("/hrv/")) return { body: { hrv: [] } };
      if (url.includes("/temp/skin/")) return { body: { tempSkin: [] } };
      if (url.includes("/cardioscore/")) return { body: { cardioScore: [] } };
      if (url.includes("/br/")) return { body: { br: [] } };
      if (url.includes("/spo2/")) return { body: [] };
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

    // Both yesterday (2024-06-14) and the oldest missing day (2024-05-16) were fetched for sleep.
    expect(seenDates.has("2024-06-14")).toBe(true);
    expect(seenDates.has("2024-05-16")).toBe(true);

    const sleepBackfill = await selectDailyRange(
      env.DB,
      "sleep_duration",
      "2024-05-16",
      "2024-05-16",
    );
    expect(sleepBackfill[0]?.value).toBe(25200);
  });

  it("skips backfill when all 30 past days of sleep_duration are already populated", async () => {
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
      if (url.includes("/br/")) return { body: { br: [] } };
      if (url.includes("/spo2/")) return { body: [] };
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

    const sleepDates = new Set(
      fetchSpy.mock.calls
        .map((c) => String(c[0]))
        .filter((u) => u.includes("/sleep/date/"))
        .map((u) => u.match(/\/date\/(\d{4}-\d{2}-\d{2})/)?.[1]),
    );
    expect(sleepDates).toEqual(new Set(["2024-06-14"]));
  });
});
