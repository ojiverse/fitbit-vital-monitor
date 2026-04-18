import { SELF, applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

describe("Worker smoke tests (real DO + D1 + R2)", () => {
  it("GET /healthz returns ok", async () => {
    const res = await SELF.fetch("http://worker/healthz");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });

  it("GET /api/vitals/latest returns empty collections on a fresh DB", async () => {
    const res = await SELF.fetch("http://worker/api/vitals/latest");
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      intraday: unknown[];
      daily: unknown[];
      devices: unknown[];
    };
    expect(json.intraday).toEqual([]);
    expect(json.daily).toEqual([]);
    expect(json.devices).toEqual([]);
  });

  it("GET /metrics returns Prometheus text after seeding", async () => {
    await env.DB.prepare("INSERT INTO vitals (timestamp, metric_type, value) VALUES (?, ?, ?)")
      .bind("2024-06-15T11:55:00.000Z", "heart_rate", 70)
      .run();
    await env.DB.prepare(
      `INSERT INTO vitals_daily (date, metric_type, value, meta)
         VALUES (?, ?, ?, NULL)
         ON CONFLICT(date, metric_type) DO UPDATE SET value = excluded.value`,
    )
      .bind("2024-06-15", "steps", 4200)
      .run();
    const res = await SELF.fetch("http://worker/metrics");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type") ?? "").toContain("text/plain");
    const body = await res.text();
    expect(body).toContain("fitbit_heart_rate_bpm 70");
    expect(body).toContain("fitbit_steps_today 4200");
  });

  it("D1 and R2 bindings are wired and respond to direct access", async () => {
    await env.ARCHIVE.put("smoke/key", "hello");
    const obj = await env.ARCHIVE.get("smoke/key");
    expect(await obj?.text()).toBe("hello");
    const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM vitals").first<{ n: number }>();
    expect(count?.n).toBeGreaterThanOrEqual(0);
  });
});
