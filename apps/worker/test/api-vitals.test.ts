import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { vitalsApp } from "../src/api/vitals";
import { upsertDevice } from "../src/db/devices";
import { insertIntradaySamples, upsertDaily } from "../src/db/vitals";
import type { HonoEnv } from "../src/types";
import { createFakeEnv } from "./helpers/fake-env";

function buildApp() {
  const app = new Hono<HonoEnv>();
  app.route("/api/vitals", vitalsApp);
  return app;
}

describe("GET /api/vitals/latest", () => {
  it("returns intraday + daily + devices latest", async () => {
    const env = createFakeEnv();
    await insertIntradaySamples(env.DB, [
      { timestamp: "2024-06-15T11:00:00.000Z", metricType: "heart_rate", value: 68 },
      { timestamp: "2024-06-15T11:55:00.000Z", metricType: "heart_rate", value: 74 },
    ]);
    await upsertDaily(env.DB, "2024-06-15", "steps", 9001);
    await upsertDevice(env.DB, {
      id: "dev1",
      type: "TRACKER",
      batteryLevel: 55,
      lastSyncAt: "2024-06-15T11:50:00.000Z",
    });
    const res = await buildApp().request("/api/vitals/latest", {}, env);
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      intraday: Array<{ metricType: string; value: number }>;
      daily: Array<{ metricType: string; value: number }>;
      devices: Array<{ id: string; batteryLevel: number | null }>;
    };
    expect(json.intraday.find((r) => r.metricType === "heart_rate")?.value).toBe(74);
    expect(json.daily.find((r) => r.metricType === "steps")?.value).toBe(9001);
    expect(json.devices[0]?.batteryLevel).toBe(55);
  });
});

describe("GET /api/vitals/daily", () => {
  it("returns matching rows for a range", async () => {
    const env = createFakeEnv();
    await upsertDaily(env.DB, "2024-06-10", "steps", 1000);
    await upsertDaily(env.DB, "2024-06-11", "steps", 2000);
    await upsertDaily(env.DB, "2024-06-14", "steps", 3000);
    const res = await buildApp().request(
      "/api/vitals/daily?metric=steps&from=2024-06-10&to=2024-06-12",
      {},
      env,
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      metric: string;
      points: Array<{ date: string; value: number }>;
    };
    expect(json.metric).toBe("steps");
    expect(json.points.map((p) => p.date)).toEqual(["2024-06-10", "2024-06-11"]);
    expect(json.points.map((p) => p.value)).toEqual([1000, 2000]);
  });

  it("rejects malformed date parameters with 400", async () => {
    const env = createFakeEnv();
    const res = await buildApp().request(
      "/api/vitals/daily?metric=steps&from=yesterday&to=today",
      {},
      env,
    );
    expect(res.status).toBe(400);
  });

  it("rejects missing metric with 400", async () => {
    const env = createFakeEnv();
    const res = await buildApp().request(
      "/api/vitals/daily?from=2024-06-10&to=2024-06-11",
      {},
      env,
    );
    expect(res.status).toBe(400);
  });
});

describe("GET /api/vitals/intraday", () => {
  it("returns the sample list for the requested day", async () => {
    const env = createFakeEnv();
    await insertIntradaySamples(env.DB, [
      { timestamp: "2024-06-14T23:59:00.000Z", metricType: "heart_rate", value: 55 },
      { timestamp: "2024-06-15T00:00:00.000Z", metricType: "heart_rate", value: 60 },
      { timestamp: "2024-06-15T23:59:00.000Z", metricType: "heart_rate", value: 72 },
      { timestamp: "2024-06-16T00:00:00.000Z", metricType: "heart_rate", value: 58 },
    ]);
    const res = await buildApp().request(
      "/api/vitals/intraday?metric=heart_rate&date=2024-06-15",
      {},
      env,
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      points: Array<{ timestamp: string; value: number }>;
    };
    expect(json.points.map((p) => p.value)).toEqual([60, 72]);
  });

  it("rejects malformed date", async () => {
    const env = createFakeEnv();
    const res = await buildApp().request(
      "/api/vitals/intraday?metric=heart_rate&date=bad",
      {},
      env,
    );
    expect(res.status).toBe(400);
  });
});
