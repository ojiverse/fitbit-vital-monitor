import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runHourly } from "../src/cron/hourly";
import { selectDevices } from "../src/db/devices";
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
  it("upserts device info (battery + last sync) — the only metric outside Subscription coverage at hourly granularity", async () => {
    const env = createFakeEnv({ USER_TIMEZONE: "UTC" });
    stubFetchByUrl((url) => {
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

  it("does not invoke breathing-rate or SpO2 endpoints (those are now webhook-driven)", async () => {
    const env = createFakeEnv({ USER_TIMEZONE: "UTC" });
    const spy = stubFetchByUrl((url) => {
      if (url.endsWith("/devices.json")) return { body: [] };
      return undefined;
    });
    await runHourly(env);
    const urls = spy.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes("/br/"))).toBe(false);
    expect(urls.some((u) => u.includes("/spo2/"))).toBe(false);
  });
});
