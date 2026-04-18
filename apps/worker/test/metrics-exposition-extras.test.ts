import { describe, expect, it } from "vitest";
import { renderExposition } from "../src/metrics/exposition";

describe("renderExposition — additional cases", () => {
  it("produces an empty-ish output when there is no data", () => {
    const out = renderExposition({
      now: new Date("2024-06-15T00:00:00Z"),
      intradayLatest: [],
      dailyLatest: [],
      rateLimit: null,
      token: null,
      sleepStages: [],
      devices: [],
    });
    expect(out).toBe("\n");
  });

  it("emits HELP and TYPE exactly once per metric family", () => {
    const out = renderExposition({
      now: new Date("2024-06-15T00:00:00Z"),
      intradayLatest: [],
      dailyLatest: [
        { metricType: "azm_fat_burn", timestamp: "2024-06-15", value: 10 },
        { metricType: "azm_cardio", timestamp: "2024-06-15", value: 5 },
        { metricType: "azm_peak", timestamp: "2024-06-15", value: 1 },
        { metricType: "azm_total", timestamp: "2024-06-15", value: 16 },
      ],
      rateLimit: null,
      token: null,
      sleepStages: [],
      devices: [],
    });
    const helpCount = (out.match(/# HELP fitbit_active_zone_minutes_today /g) ?? []).length;
    const typeCount = (out.match(/# TYPE fitbit_active_zone_minutes_today /g) ?? []).length;
    expect(helpCount).toBe(1);
    expect(typeCount).toBe(1);
    expect(out).toContain('fitbit_active_zone_minutes_today{zone="fat_burn"} 10');
    expect(out).toContain('fitbit_active_zone_minutes_today{zone="total"} 16');
  });

  it("clamps rate-limit reset seconds to zero when already elapsed", () => {
    const now = new Date("2024-06-15T12:00:00Z");
    const out = renderExposition({
      now,
      intradayLatest: [],
      dailyLatest: [],
      rateLimit: {
        limitTotal: 150,
        remaining: 140,
        resetAt: new Date("2024-06-15T11:59:00Z"),
      },
      token: null,
      sleepStages: [],
      devices: [],
    });
    expect(out).toContain("fitbit_api_rate_limit_reset_seconds 0");
  });

  it("omits battery metric when batteryLevel is null but still emits last-sync", () => {
    const out = renderExposition({
      now: new Date("2024-06-15T12:00:00Z"),
      intradayLatest: [],
      dailyLatest: [],
      rateLimit: null,
      token: null,
      sleepStages: [],
      devices: [
        {
          id: "d1",
          type: "SCALE",
          batteryLevel: null,
          lastSyncAt: "2024-06-15T10:00:00.000Z",
          updatedAt: "2024-06-15T10:00:00.000Z",
        },
      ],
    });
    expect(out).not.toContain("fitbit_device_battery_percent");
    expect(out).toContain(
      'fitbit_device_last_sync_timestamp_seconds{device_id="d1",device_type="SCALE"}',
    );
  });

  it("escapes label values containing quotes or backslashes", () => {
    const out = renderExposition({
      now: new Date("2024-06-15T12:00:00Z"),
      intradayLatest: [],
      dailyLatest: [],
      rateLimit: null,
      token: null,
      sleepStages: [],
      devices: [
        {
          id: 'weird"id\\',
          type: "TRACKER",
          batteryLevel: 10,
          lastSyncAt: "2024-06-15T10:00:00.000Z",
          updatedAt: "2024-06-15T10:00:00.000Z",
        },
      ],
    });
    expect(out).toContain('device_id="weird\\"id\\\\"');
  });
});
