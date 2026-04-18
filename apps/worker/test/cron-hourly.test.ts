import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runHourly } from "../src/cron/hourly";
import { selectDevices } from "../src/db/devices";
import { selectDailyRange } from "../src/db/vitals";
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

describe("runHourly", () => {
  it("stores breathing rate, SpO2 with min/max meta, and upserts devices", async () => {
    const env = createFakeEnv({ USER_TIMEZONE: "UTC" });
    stubFetchByUrl((url) => {
      if (url.includes("/br/")) {
        return { body: { br: [{ dateTime: "2024-06-15", value: { breathingRate: 13.8 } }] } };
      }
      if (url.includes("/spo2/")) {
        return {
          body: { dateTime: "2024-06-15", value: { avg: 96, min: 93, max: 99 } },
        };
      }
      if (url.endsWith("/devices.json")) {
        return {
          body: [
            {
              id: "dev1",
              type: "TRACKER",
              deviceVersion: "Charge 5",
              batteryLevel: 72,
              battery: "Medium",
              lastSyncTime: "2024-06-15T02:55:00.000",
            },
          ],
        };
      }
      return undefined;
    });

    await runHourly(env);

    const daily = await selectDailyRange(env.DB, "breathing_rate", "2024-06-15", "2024-06-15");
    expect(daily[0]?.value).toBe(13.8);

    const spo2 = await selectDailyRange(env.DB, "spo2", "2024-06-15", "2024-06-15");
    expect(spo2[0]?.value).toBe(96);
    expect(JSON.parse(spo2[0]?.meta ?? "null")).toEqual({ min: 93, max: 99 });

    const devices = await selectDevices(env.DB);
    expect(devices).toEqual([
      expect.objectContaining({
        id: "dev1",
        type: "TRACKER",
        batteryLevel: 72,
        lastSyncAt: "2024-06-15T02:55:00.000",
      }),
    ]);
  });

  it("skips writes when Fitbit returns no breathing/spo2 data and still records devices", async () => {
    const env = createFakeEnv({ USER_TIMEZONE: "UTC" });
    stubFetchByUrl((url) => {
      if (url.includes("/br/")) return { body: { br: [] } };
      if (url.includes("/spo2/")) return { body: [] };
      if (url.endsWith("/devices.json")) {
        return {
          body: [
            {
              id: "dev2",
              type: "SCALE",
              deviceVersion: "Aria",
              lastSyncTime: "2024-06-10T09:00:00.000",
            },
          ],
        };
      }
      return undefined;
    });

    await runHourly(env);

    const br = await selectDailyRange(env.DB, "breathing_rate", "2024-06-15", "2024-06-15");
    expect(br).toEqual([]);
    const spo2 = await selectDailyRange(env.DB, "spo2", "2024-06-15", "2024-06-15");
    expect(spo2).toEqual([]);
    const devices = await selectDevices(env.DB);
    expect(devices.map((d) => d.id)).toEqual(["dev2"]);
  });
});
