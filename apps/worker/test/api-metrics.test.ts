import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { metricsApp } from "../src/api/metrics";
import { upsertRateLimit } from "../src/db/rate-limit";
import { upsertToken } from "../src/db/tokens";
import { insertIntradaySamples, upsertDaily } from "../src/db/vitals";
import type { HonoEnv } from "../src/types";
import { addDays, todayInTimezone } from "../src/util/time";
import { createFakeEnv } from "./helpers/fake-env";

function buildApp() {
  const app = new Hono<HonoEnv>();
  app.route("/metrics", metricsApp);
  return app;
}

describe("GET /metrics", () => {
  it("returns Prometheus exposition with the expected content type", async () => {
    const env = createFakeEnv();
    await insertIntradaySamples(env.DB, [
      { timestamp: "2024-06-15T11:55:00.000Z", metricType: "heart_rate", value: 72 },
    ]);
    await upsertDaily(env.DB, "2024-06-15", "steps", 8000);
    await upsertRateLimit(env.DB, {
      limitTotal: 150,
      remaining: 140,
      resetAt: new Date(Date.now() + 60_000),
    });
    await upsertToken(env.DB, {
      accessToken: "A",
      refreshToken: "R",
      expiresAt: new Date(Date.now() + 3600_000),
      scope: "",
      fitbitUserId: "U",
      updatedAt: new Date(),
    });
    const res = await buildApp().request("/metrics", {}, env);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type") ?? "").toContain("text/plain");
    const body = await res.text();
    expect(body).toContain("fitbit_heart_rate_bpm 72");
    expect(body).toContain("fitbit_steps_today 8000");
    expect(body).toContain("fitbit_api_rate_limit_total 150");
    expect(body).toContain("fitbit_token_expires_at_timestamp_seconds");
  });

  it("includes sleep stages from the most recent sleep_duration meta", async () => {
    const env = createFakeEnv();
    const meta = {
      startIso: "2024-06-14T23:00:00.000Z",
      endIso: "2024-06-15T07:00:00.000Z",
      stages: { deep: 3600, light: 14400, rem: 7200, wake: 1800 },
    };
    // Seed for "yesterday" in the same timezone the handler queries against
    // (env.USER_TIMEZONE = Asia/Tokyo). Using UTC date arithmetic here makes
    // the assertion flaky between 15:00 UTC (= 00:00 JST next day) and
    // midnight UTC, when the test's "yesterday" lags the handler's by 1 day.
    const ymd = addDays(todayInTimezone(env.USER_TIMEZONE), -1);
    await upsertDaily(env.DB, ymd, "sleep_duration", 28800, meta);
    const res = await buildApp().request("/metrics", {}, env);
    const body = await res.text();
    expect(body).toContain('fitbit_sleep_stage_seconds{stage="deep"} 3600');
    expect(body).toContain('fitbit_sleep_stage_seconds{stage="rem"} 7200');
  });

  it("tolerates an empty database", async () => {
    const env = createFakeEnv();
    const res = await buildApp().request("/metrics", {}, env);
    expect(res.status).toBe(200);
    // No metrics emitted but the response should still be well-formed text
    expect(res.headers.get("Content-Type") ?? "").toContain("text/plain");
  });
});
