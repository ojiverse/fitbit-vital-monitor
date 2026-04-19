import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { webhookApp } from "../src/api/webhook";
import { selectDailyRange } from "../src/db/vitals";
import { computeFitbitSignature } from "../src/fitbit/webhook-signature";
import type { HonoEnv } from "../src/types";
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

function buildApp() {
  const app = new Hono<HonoEnv>();
  app.route("/webhook/fitbit", webhookApp);
  return app;
}

type CapturingExecutionCtx = ExecutionContext & { readonly pending: Promise<unknown>[] };

function createCapturingCtx(): CapturingExecutionCtx {
  const pending: Promise<unknown>[] = [];
  const ctx: CapturingExecutionCtx = {
    waitUntil(promise: Promise<unknown>): void {
      pending.push(promise);
    },
    passThroughOnException(): void {},
    pending,
  } as CapturingExecutionCtx;
  return ctx;
}

async function postSigned(args: {
  body: string;
  env: ReturnType<typeof createFakeEnv>;
  ctx: ExecutionContext;
  signature?: string;
}): Promise<Response> {
  const sig =
    args.signature ?? (await computeFitbitSignature(args.body, args.env.FITBIT_CLIENT_SECRET));
  return buildApp().request(
    "/webhook/fitbit",
    {
      method: "POST",
      headers: { "x-fitbit-signature": sig, "content-type": "application/json" },
      body: args.body,
    },
    args.env,
    args.ctx,
  );
}

describe("GET /webhook/fitbit (verification challenge)", () => {
  it("returns 204 when ?verify matches the configured token", async () => {
    const env = createFakeEnv({ FITBIT_SUBSCRIBER_VERIFY: "secret-verify" });
    const res = await buildApp().request("/webhook/fitbit?verify=secret-verify", {}, env);
    expect(res.status).toBe(204);
  });

  it("returns 404 when ?verify does not match", async () => {
    const env = createFakeEnv({ FITBIT_SUBSCRIBER_VERIFY: "secret-verify" });
    const res = await buildApp().request("/webhook/fitbit?verify=wrong", {}, env);
    expect(res.status).toBe(404);
  });

  it("returns 404 when ?verify is missing (Fitbit spec)", async () => {
    const env = createFakeEnv({ FITBIT_SUBSCRIBER_VERIFY: "secret-verify" });
    const res = await buildApp().request("/webhook/fitbit", {}, env);
    expect(res.status).toBe(404);
  });
});

describe("POST /webhook/fitbit (signed notifications)", () => {
  it("rejects with 401 when the signature header is missing", async () => {
    const env = createFakeEnv();
    const ctx = createCapturingCtx();
    const res = await buildApp().request(
      "/webhook/fitbit",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "[]",
      },
      env,
      ctx,
    );
    expect(res.status).toBe(401);
    expect(ctx.pending).toHaveLength(0);
  });

  it("rejects with 401 when the signature is invalid", async () => {
    const env = createFakeEnv();
    const ctx = createCapturingCtx();
    const res = await postSigned({
      env,
      ctx,
      body: "[]",
      signature: "AAAAAAAAAAAAAAAAAAAAAAAAAAA=",
    });
    expect(res.status).toBe(401);
    expect(ctx.pending).toHaveLength(0);
  });

  it("rejects with 400 when the body is not valid JSON (after passing signature)", async () => {
    const env = createFakeEnv();
    const ctx = createCapturingCtx();
    const body = "not-json";
    const res = await postSigned({ env, ctx, body });
    expect(res.status).toBe(400);
    expect(ctx.pending).toHaveLength(0);
  });

  it("rejects with 400 when the body is not the expected array shape", async () => {
    const env = createFakeEnv();
    const ctx = createCapturingCtx();
    const body = JSON.stringify({ collectionType: "sleep" });
    const res = await postSigned({ env, ctx, body });
    expect(res.status).toBe(400);
    expect(ctx.pending).toHaveLength(0);
  });

  it("returns 204 immediately on a valid signed sleep notification and dispatches sleep+wake-up bundle for yesterday", async () => {
    const env = createFakeEnv({ USER_TIMEZONE: "UTC" });
    const ctx = createCapturingCtx();
    const calledUrls: string[] = [];
    stubFetchByUrl((url) => {
      calledUrls.push(url);
      if (url.includes("/sleep/date/")) {
        return {
          body: {
            sleep: [
              {
                isMainSleep: true,
                duration: 27000000,
                efficiency: 92,
                startTime: "2024-06-14T22:30:00.000",
                endTime: "2024-06-15T06:00:00.000",
                levels: {
                  summary: {
                    deep: { minutes: 80 },
                    light: { minutes: 210 },
                    rem: { minutes: 100 },
                    wake: { minutes: 25 },
                  },
                },
              },
            ],
          },
        };
      }
      if (url.includes("/hrv/")) {
        return {
          body: { hrv: [{ dateTime: "2024-06-14", value: { dailyRmssd: 41, deepRmssd: 48 } }] },
        };
      }
      if (url.includes("/temp/skin/")) {
        return {
          body: { tempSkin: [{ dateTime: "2024-06-14", value: { nightlyRelative: 0.1 } }] },
        };
      }
      if (url.includes("/cardioscore/")) {
        return { body: { cardioScore: [{ dateTime: "2024-06-14", value: { vo2Max: 42 } }] } };
      }
      if (url.includes("/br/")) {
        return { body: { br: [{ dateTime: "2024-06-14", value: { breathingRate: 14.2 } }] } };
      }
      if (url.includes("/spo2/")) {
        return { body: { dateTime: "2024-06-14", value: { avg: 97, min: 94, max: 99 } } };
      }
      return undefined;
    });

    const body = JSON.stringify([
      {
        collectionType: "sleep",
        date: "2024-06-15",
        ownerId: "USER1",
        ownerType: "user",
        subscriptionId: "sleep-1",
      },
    ]);
    const res = await postSigned({ env, ctx, body });
    expect(res.status).toBe(204);

    await Promise.all(ctx.pending);

    // All six wake-up confirmed metrics were fetched against yesterday (2024-06-14).
    expect(calledUrls.some((u) => u.includes("/sleep/date/2024-06-14"))).toBe(true);
    expect(calledUrls.some((u) => u.includes("/hrv/date/2024-06-14"))).toBe(true);
    expect(calledUrls.some((u) => u.includes("/temp/skin/date/2024-06-14"))).toBe(true);
    expect(calledUrls.some((u) => u.includes("/cardioscore/date/2024-06-14"))).toBe(true);
    expect(calledUrls.some((u) => u.includes("/br/date/2024-06-14"))).toBe(true);
    expect(calledUrls.some((u) => u.includes("/spo2/date/2024-06-14"))).toBe(true);

    // Verify a couple of upserts landed in D1 keyed at yesterday.
    const sleep = await selectDailyRange(env.DB, "sleep_duration", "2024-06-14", "2024-06-14");
    expect(sleep[0]?.value).toBe(27000);
    const hrv = await selectDailyRange(env.DB, "hrv_rmssd", "2024-06-14", "2024-06-14");
    expect(hrv[0]?.value).toBe(41);
  });

  it("dispatches activity + AZM for today on an `activities` notification", async () => {
    const env = createFakeEnv({ USER_TIMEZONE: "UTC" });
    const ctx = createCapturingCtx();
    const calledUrls: string[] = [];
    stubFetchByUrl((url) => {
      calledUrls.push(url);
      if (url.includes("/activities/date/")) {
        return {
          body: {
            summary: {
              steps: 8421,
              caloriesOut: 2300,
              floors: 12,
              distances: [{ activity: "total", distance: 6.4 }],
            },
          },
        };
      }
      if (url.includes("/active-zone-minutes/")) {
        return {
          body: {
            "activities-active-zone-minutes": [
              {
                dateTime: "2024-06-15",
                value: {
                  fatBurnActiveZoneMinutes: 20,
                  cardioActiveZoneMinutes: 5,
                  activeZoneMinutes: 30,
                },
              },
            ],
          },
        };
      }
      return undefined;
    });

    const body = JSON.stringify([
      { collectionType: "activities", date: "2024-06-15", subscriptionId: "act-1" },
    ]);
    const res = await postSigned({ env, ctx, body });
    expect(res.status).toBe(204);
    await Promise.all(ctx.pending);

    expect(calledUrls.some((u) => u.includes("/activities/date/2024-06-15"))).toBe(true);
    expect(calledUrls.some((u) => u.includes("/active-zone-minutes/date/2024-06-15"))).toBe(true);
    const steps = await selectDailyRange(env.DB, "steps", "2024-06-15", "2024-06-15");
    expect(steps[0]?.value).toBe(8421);
    const azm = await selectDailyRange(env.DB, "azm_total", "2024-06-15", "2024-06-15");
    expect(azm[0]?.value).toBe(30);
  });

  it("dispatches weight log fetch for today on a `body` notification", async () => {
    const env = createFakeEnv({ USER_TIMEZONE: "UTC" });
    const ctx = createCapturingCtx();
    const calledUrls: string[] = [];
    stubFetchByUrl((url) => {
      calledUrls.push(url);
      if (url.includes("/body/log/weight/")) {
        return {
          body: {
            weight: [{ date: "2024-06-15", time: "07:30:00", weight: 70.1, bmi: 21.6, fat: 18.0 }],
          },
        };
      }
      return undefined;
    });

    const body = JSON.stringify([
      { collectionType: "body", date: "2024-06-15", subscriptionId: "body-1" },
    ]);
    const res = await postSigned({ env, ctx, body });
    expect(res.status).toBe(204);
    await Promise.all(ctx.pending);

    expect(calledUrls.some((u) => u.includes("/body/log/weight/date/2024-06-15"))).toBe(true);
    const weight = await selectDailyRange(env.DB, "weight", "2024-06-15", "2024-06-15");
    expect(weight[0]?.value).toBe(70.1);
  });

  it("ignores unknown collection types without making any fetch", async () => {
    const env = createFakeEnv({ USER_TIMEZONE: "UTC" });
    const ctx = createCapturingCtx();
    const fetchSpy = stubFetchByUrl(() => undefined);
    const body = JSON.stringify([
      { collectionType: "foods", date: "2024-06-15", subscriptionId: "foods-1" },
    ]);
    const res = await postSigned({ env, ctx, body });
    expect(res.status).toBe(204);
    await Promise.all(ctx.pending);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("deduplicates repeated collection types in a single notification batch", async () => {
    const env = createFakeEnv({ USER_TIMEZONE: "UTC" });
    const ctx = createCapturingCtx();
    const calls: string[] = [];
    stubFetchByUrl((url) => {
      calls.push(url);
      if (url.includes("/body/log/weight/")) {
        return {
          body: { weight: [{ date: "2024-06-15", weight: 70 }] },
        };
      }
      return undefined;
    });
    const body = JSON.stringify([
      { collectionType: "body", date: "2024-06-15", subscriptionId: "body-1" },
      { collectionType: "body", date: "2024-06-15", subscriptionId: "body-1" },
    ]);
    const res = await postSigned({ env, ctx, body });
    expect(res.status).toBe(204);
    await Promise.all(ctx.pending);
    const bodyCalls = calls.filter((u) => u.includes("/body/log/weight/"));
    expect(bodyCalls).toHaveLength(1);
  });
});
