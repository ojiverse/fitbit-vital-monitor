import { describe, expect, it } from "vitest";
import { renderExposition } from "../src/metrics/exposition";

describe("renderExposition", () => {
  it("renders all standard metric families with labels", () => {
    const now = new Date("2024-06-15T12:00:00Z");
    const output = renderExposition({
      now,
      intradayLatest: [{ metricType: "heart_rate", timestamp: "2024-06-15T11:55:00Z", value: 72 }],
      dailyLatest: [
        { metricType: "steps", timestamp: "2024-06-15", value: 8432 },
        { metricType: "azm_fat_burn", timestamp: "2024-06-15", value: 12 },
        { metricType: "azm_cardio", timestamp: "2024-06-15", value: 3 },
      ],
      rateLimit: {
        limitTotal: 150,
        remaining: 137,
        resetAt: new Date("2024-06-15T12:00:30Z"),
      },
      token: {
        accessToken: "A",
        refreshToken: "R",
        expiresAt: new Date("2024-06-15T20:00:00Z"),
        scope: "",
        fitbitUserId: "u",
        updatedAt: new Date("2024-06-15T11:00:00Z"),
      },
      sleepStages: [{ stage: "deep", seconds: 3600 }],
      devices: [
        {
          id: "dev1",
          type: "TRACKER",
          batteryLevel: 75,
          lastSyncAt: "2024-06-15T11:50:00Z",
          updatedAt: "2024-06-15T11:50:00Z",
        },
      ],
    });
    expect(output).toContain("# TYPE fitbit_heart_rate_bpm gauge");
    expect(output).toContain("fitbit_heart_rate_bpm 72");
    expect(output).toContain('fitbit_active_zone_minutes_today{zone="fat_burn"} 12');
    expect(output).toContain('fitbit_active_zone_minutes_today{zone="cardio"} 3');
    expect(output).toContain("fitbit_steps_today 8432");
    expect(output).toContain("fitbit_api_rate_limit_remaining 137");
    expect(output).toContain("fitbit_api_rate_limit_total 150");
    expect(output).toContain("fitbit_token_expires_at_timestamp_seconds 1718481600");
    expect(output).toContain('fitbit_sleep_stage_seconds{stage="deep"} 3600');
    expect(output).toContain(
      'fitbit_device_battery_percent{device_id="dev1",device_type="TRACKER"} 75',
    );
    expect(output).toContain('fitbit_data_freshness_seconds{metric="heart_rate"} 300');
  });

  it("skips unknown metric types silently", () => {
    const output = renderExposition({
      now: new Date(),
      intradayLatest: [
        { metricType: "unknown_metric", timestamp: "2024-06-15T00:00:00Z", value: 1 },
      ],
      dailyLatest: [],
      rateLimit: null,
      token: null,
      sleepStages: [],
      devices: [],
    });
    expect(output).not.toContain("unknown_metric");
  });
});
