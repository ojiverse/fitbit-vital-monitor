import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getBreathingRate,
  getCardioScore,
  getDevices,
  getHeartRateIntraday,
  getHrv,
  getSkinTemp,
  getSleep,
  getSpo2Daily,
  getWeightLog,
} from "../src/fitbit/endpoints";

function stub(body: unknown): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })),
  );
}

afterEach(() => vi.restoreAllMocks());

describe("fitbit endpoint wrappers — null / edge cases", () => {
  it("heart rate returns null resting HR when activities-heart is empty", async () => {
    stub({ "activities-heart": [], "activities-heart-intraday": { dataset: [] } });
    const res = await getHeartRateIntraday("T", "2024-06-15");
    expect(res.data.restingHeartRate).toBeNull();
    expect(res.data.intraday).toEqual([]);
  });

  it("breathing rate returns null when br array is empty", async () => {
    stub({ br: [] });
    const res = await getBreathingRate("T", "2024-06-15");
    expect(res.data).toBeNull();
  });

  it("breathing rate parses a value when present", async () => {
    stub({ br: [{ dateTime: "2024-06-15", value: { breathingRate: 14.2 } }] });
    const res = await getBreathingRate("T", "2024-06-15");
    expect(res.data).toBe(14.2);
  });

  it("spo2 handles single-object response shape", async () => {
    stub({ dateTime: "2024-06-15", value: { avg: 96, min: 92, max: 99 } });
    const res = await getSpo2Daily("T", "2024-06-15");
    expect(res.data).toEqual({ avg: 96, min: 92, max: 99 });
  });

  it("spo2 handles array response shape", async () => {
    stub([{ dateTime: "2024-06-15", value: { avg: 95, min: 91, max: 98 } }]);
    const res = await getSpo2Daily("T", "2024-06-15");
    expect(res.data).toEqual({ avg: 95, min: 91, max: 98 });
  });

  it("spo2 returns null on empty array", async () => {
    stub([]);
    const res = await getSpo2Daily("T", "2024-06-15");
    expect(res.data).toBeNull();
  });

  it("hrv returns null when array is empty and includes deepRmssd when present", async () => {
    stub({ hrv: [] });
    expect((await getHrv("T", "2024-06-15")).data).toBeNull();
    stub({
      hrv: [{ dateTime: "2024-06-15", value: { dailyRmssd: 35, deepRmssd: 40 } }],
    });
    expect((await getHrv("T", "2024-06-15")).data).toEqual({ dailyRmssd: 35, deepRmssd: 40 });
    stub({
      hrv: [{ dateTime: "2024-06-15", value: { dailyRmssd: 30 } }],
    });
    expect((await getHrv("T", "2024-06-15")).data).toEqual({ dailyRmssd: 30, deepRmssd: null });
  });

  it("skin temp returns null when empty, value when present", async () => {
    stub({ tempSkin: [] });
    expect((await getSkinTemp("T", "2024-06-15")).data).toBeNull();
    stub({ tempSkin: [{ dateTime: "2024-06-15", value: { nightlyRelative: -0.3 } }] });
    expect((await getSkinTemp("T", "2024-06-15")).data).toBe(-0.3);
  });

  it("cardio score accepts numeric vo2Max", async () => {
    stub({ cardioScore: [{ dateTime: "2024-06-15", value: { vo2Max: 42 } }] });
    expect((await getCardioScore("T", "2024-06-15")).data).toBe(42);
  });

  it("cardio score returns null when vo2Max is unparseable", async () => {
    stub({ cardioScore: [{ dateTime: "2024-06-15", value: { vo2Max: "not-a-number" } }] });
    expect((await getCardioScore("T", "2024-06-15")).data).toBeNull();
  });

  it("sleep returns null when no sleep sessions logged", async () => {
    stub({ sleep: [] });
    expect((await getSleep("T", "2024-06-15")).data).toBeNull();
  });

  it("sleep falls back to first session when isMainSleep is missing", async () => {
    stub({
      sleep: [
        {
          duration: 3600000,
          efficiency: 88,
          startTime: "2024-06-15T01:00:00.000",
          endTime: "2024-06-15T02:00:00.000",
        },
      ],
    });
    const res = await getSleep("T", "2024-06-15");
    expect(res.data?.durationSeconds).toBe(3600);
    expect(res.data?.stages).toEqual({ deep: 0, light: 0, rem: 0, wake: 0 });
  });

  it("weight log returns the most recent entry when multiple present", async () => {
    stub({
      weight: [
        { date: "2024-06-14", weight: 70.0, bmi: 22.0, fat: 18.0, time: "08:00:00" },
        { date: "2024-06-15", weight: 69.5, bmi: 21.8, fat: 17.9, time: "08:05:00" },
      ],
    });
    const res = await getWeightLog("T", "2024-06-15");
    expect(res.data?.weight).toBe(69.5);
    expect(res.data?.bmi).toBe(21.8);
    expect(res.data?.fat).toBe(17.9);
    expect(res.data?.observedAt).toBe("2024-06-15T08:05:00");
  });

  it("weight log returns null when empty", async () => {
    stub({ weight: [] });
    expect((await getWeightLog("T", "2024-06-15")).data).toBeNull();
  });

  it("devices maps battery level and last sync", async () => {
    stub([
      {
        id: "dev1",
        type: "TRACKER",
        deviceVersion: "Charge 5",
        batteryLevel: 60,
        battery: "Medium",
        lastSyncTime: "2024-06-15T11:00:00.000",
      },
      {
        id: "dev2",
        type: "SCALE",
        deviceVersion: "Aria",
        lastSyncTime: "2024-06-10T10:00:00.000",
      },
    ]);
    const res = await getDevices("T");
    expect(res.data).toEqual([
      { id: "dev1", type: "TRACKER", batteryLevel: 60, lastSyncTime: "2024-06-15T11:00:00.000" },
      { id: "dev2", type: "SCALE", batteryLevel: null, lastSyncTime: "2024-06-10T10:00:00.000" },
    ]);
  });
});
