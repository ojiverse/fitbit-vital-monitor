import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getActivitySummary,
  getAzmSummary,
  getCardioScore,
  getHeartRateIntraday,
  getSleep,
} from "../src/fitbit/endpoints";

function stubFetchOnce(body: unknown): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })),
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fitbit endpoint wrappers", () => {
  it("parses heart rate intraday response", async () => {
    stubFetchOnce({
      "activities-heart": [{ dateTime: "2024-06-15", value: { restingHeartRate: 58 } }],
      "activities-heart-intraday": {
        dataset: [
          { time: "00:00:00", value: 60 },
          { time: "00:01:00", value: 62 },
        ],
      },
    });
    const res = await getHeartRateIntraday("T", "2024-06-15");
    expect(res.data.restingHeartRate).toBe(58);
    expect(res.data.intraday).toEqual([
      { time: "00:00:00", value: 60 },
      { time: "00:01:00", value: 62 },
    ]);
  });

  it("parses activity summary and converts distance to meters", async () => {
    stubFetchOnce({
      summary: {
        steps: 10000,
        caloriesOut: 2500,
        floors: 12,
        distances: [
          { activity: "total", distance: 7.5 },
          { activity: "tracker", distance: 7.4 },
        ],
      },
    });
    const res = await getActivitySummary("T", "2024-06-15");
    expect(res.data).toEqual({
      steps: 10000,
      calories: 2500,
      floors: 12,
      distanceMeters: 7500,
    });
  });

  it("sums AZM zones when total is missing", async () => {
    stubFetchOnce({
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
    });
    const res = await getAzmSummary("T", "2024-06-15");
    expect(res.data).toEqual({ fatBurn: 10, cardio: 5, peak: 1, total: 16 });
  });

  it("averages vo2Max range values for cardio score", async () => {
    stubFetchOnce({
      cardioScore: [{ dateTime: "2024-06-15", value: { vo2Max: "40-42" } }],
    });
    const res = await getCardioScore("T", "2024-06-15");
    expect(res.data).toBe(41);
  });

  it("extracts main sleep stages in seconds", async () => {
    stubFetchOnce({
      sleep: [
        {
          isMainSleep: true,
          duration: 28800000,
          efficiency: 92,
          startTime: "2024-06-14T23:00:00.000",
          endTime: "2024-06-15T07:00:00.000",
          levels: {
            summary: {
              deep: { minutes: 90 },
              light: { minutes: 240 },
              rem: { minutes: 120 },
              wake: { minutes: 30 },
            },
          },
        },
      ],
    });
    const res = await getSleep("T", "2024-06-15");
    expect(res.data?.durationSeconds).toBe(28800);
    expect(res.data?.efficiency).toBe(92);
    expect(res.data?.stages).toEqual({
      deep: 5400,
      light: 14400,
      rem: 7200,
      wake: 1800,
    });
  });
});
