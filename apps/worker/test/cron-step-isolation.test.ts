import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runHighFrequency } from "../src/cron/high-frequency";
import { runSteps } from "../src/cron/run-steps";
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

describe("runSteps", () => {
  it("runs every step even when one throws", async () => {
    const log: string[] = [];
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const results = await runSteps("test", [
      { name: "a", run: async () => void log.push("a") },
      {
        name: "b",
        run: async () => {
          log.push("b-start");
          throw new Error("boom");
        },
      },
      { name: "c", run: async () => void log.push("c") },
    ]);

    expect(log).toEqual(["a", "b-start", "c"]);
    expect(results).toEqual([
      { name: "a", ok: true },
      { name: "b", ok: false, error: "boom" },
      { name: "c", ok: true },
    ]);
    expect(errorSpy).toHaveBeenCalledWith("[cron:test] step b failed: boom");
  });

  it("throws when every step fails so the scheduled handler marks the run as failed", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      runSteps("test", [
        {
          name: "a",
          run: async () => {
            throw new Error("x");
          },
        },
        {
          name: "b",
          run: async () => {
            throw new Error("y");
          },
        },
      ]),
    ).rejects.toThrow(/all 2 steps failed.*a\(x\).*b\(y\)/);
  });

  it("does not throw for an empty step list", async () => {
    await expect(runSteps("test", [])).resolves.toEqual([]);
  });
});

describe("runHighFrequency step isolation", () => {
  it("still records heart rate and activity when AZM returns 403", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const env = createFakeEnv({ USER_TIMEZONE: "UTC" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.includes("/activities/heart/date/")) {
          return new Response(
            JSON.stringify({
              "activities-heart": [{ dateTime: "2024-06-15", value: { restingHeartRate: 58 } }],
              "activities-heart-intraday": { dataset: [{ time: "00:00:00", value: 60 }] },
            }),
            { status: 200, headers: rateLimitHeaders() },
          );
        }
        if (url.includes("/activities/active-zone-minutes/")) {
          return new Response(
            JSON.stringify({ errors: [{ errorType: "insufficient_permissions" }] }),
            { status: 403, headers: rateLimitHeaders() },
          );
        }
        if (url.includes("/activities/date/")) {
          return new Response(
            JSON.stringify({
              summary: {
                steps: 1234,
                caloriesOut: 1500,
                floors: 3,
                distances: [{ activity: "total", distance: 1.2 }],
              },
            }),
            { status: 200, headers: rateLimitHeaders() },
          );
        }
        return new Response(`unexpected ${url}`, { status: 500 });
      }),
    );

    await runHighFrequency(env);

    const steps = await selectDailyRange(env.DB, "steps", "2024-06-15", "2024-06-15");
    expect(steps[0]?.value).toBe(1234);
    const resting = await selectDailyRange(
      env.DB,
      "heart_rate_resting",
      "2024-06-15",
      "2024-06-15",
    );
    expect(resting[0]?.value).toBe(58);
    const azm = await selectDailyRange(env.DB, "azm_total", "2024-06-15", "2024-06-15");
    expect(azm).toEqual([]);
  });

  it("throws when every Fitbit endpoint fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const env = createFakeEnv({ USER_TIMEZONE: "UTC" });
    stubFetchByUrl(() => undefined); // every call → 500 via fetch-mock default

    await expect(runHighFrequency(env)).rejects.toThrow(/all 3 steps failed/);
  });
});

function rateLimitHeaders(): Record<string, string> {
  return {
    "fitbit-rate-limit-limit": "150",
    "fitbit-rate-limit-remaining": "140",
    "fitbit-rate-limit-reset": "1200",
  };
}
