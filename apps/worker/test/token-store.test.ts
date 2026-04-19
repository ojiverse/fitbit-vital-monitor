import { afterEach, describe, expect, it, vi } from "vitest";
import { getToken } from "../src/db/tokens";
import { TokenStore } from "../src/token-store";
import type { Env } from "../src/types";
import { createFakeCtx } from "./helpers/fake-do-ctx";
import { createFakeEnv } from "./helpers/fake-env";

function makeTokenResponse(
  overrides: Partial<{ access_token: string; refresh_token: string; expires_in: number }> = {},
) {
  return {
    access_token: overrides.access_token ?? "NEW_ACCESS",
    refresh_token: overrides.refresh_token ?? "NEW_REFRESH",
    expires_in: overrides.expires_in ?? 28800,
    scope: "activity heartrate",
    token_type: "Bearer",
    user_id: "USER_ID",
  };
}

function stubTokenFetch(body: unknown) {
  const spy = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
  vi.stubGlobal("fetch", spy);
  return spy;
}

afterEach(() => vi.restoreAllMocks());

describe("TokenStore.getValidToken", () => {
  it("uses the seed when D1 is empty and persists the refreshed token", async () => {
    const env = createFakeEnv();
    const spy = stubTokenFetch(makeTokenResponse());
    const store = new TokenStore(createFakeCtx() as DurableObjectState, env as Env);

    const token = await store.getValidToken();
    expect(token).toBe("NEW_ACCESS");
    expect(spy).toHaveBeenCalledTimes(1);

    const stored = await getToken(env.DB);
    expect(stored?.accessToken).toBe("NEW_ACCESS");
    expect(stored?.refreshToken).toBe("NEW_REFRESH");
  });

  it("returns the stored access token without refreshing when far from expiry", async () => {
    const env = createFakeEnv();
    // seed a valid token directly into D1
    await env.DB.prepare(
      `INSERT INTO auth_tokens (id, access_token, refresh_token, expires_at, scope, fitbit_user_id, updated_at)
         VALUES (1, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        "STORED_ACCESS",
        "STORED_REFRESH",
        new Date(Date.now() + 6 * 3600 * 1000).toISOString(),
        "activity",
        "USER_ID",
        new Date().toISOString(),
      )
      .run();
    const spy = stubTokenFetch(makeTokenResponse());
    const store = new TokenStore(createFakeCtx() as DurableObjectState, env as Env);

    const token = await store.getValidToken();
    expect(token).toBe("STORED_ACCESS");
    expect(spy).not.toHaveBeenCalled();
  });

  it("refreshes when within the 30 minute window", async () => {
    const env = createFakeEnv();
    await env.DB.prepare(
      `INSERT INTO auth_tokens (id, access_token, refresh_token, expires_at, scope, fitbit_user_id, updated_at)
         VALUES (1, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        "ABOUT_TO_EXPIRE",
        "CURRENT_REFRESH",
        new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        "activity",
        "USER_ID",
        new Date().toISOString(),
      )
      .run();
    const fetchSpy = stubTokenFetch(
      makeTokenResponse({ access_token: "REFRESHED", refresh_token: "NEXT" }),
    );
    const store = new TokenStore(createFakeCtx() as DurableObjectState, env as Env);

    const token = await store.getValidToken();
    expect(token).toBe("REFRESHED");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const call = fetchSpy.mock.calls[0];
    const init = (call as unknown as [unknown, RequestInit])[1];
    const body = init.body as URLSearchParams;
    expect(body.get("refresh_token")).toBe("CURRENT_REFRESH");

    const stored = await getToken(env.DB);
    expect(stored?.accessToken).toBe("REFRESHED");
    expect(stored?.refreshToken).toBe("NEXT");
  });

  it("throws when neither D1 nor the seed have a refresh token", async () => {
    const env = { ...createFakeEnv(), FITBIT_REFRESH_TOKEN_SEED: "" } as unknown as Env;
    const store = new TokenStore(createFakeCtx() as DurableObjectState, env);
    await expect(store.getValidToken()).rejects.toThrow(/refresh_token/);
  });

  it("falls back to the seed when the stored refresh_token is rejected with 401", async () => {
    const env = createFakeEnv();
    await env.DB.prepare(
      `INSERT INTO auth_tokens (id, access_token, refresh_token, expires_at, scope, fitbit_user_id, updated_at)
         VALUES (1, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        "EXPIRED_ACCESS",
        "STALE_REFRESH",
        new Date(Date.now() - 60 * 1000).toISOString(),
        "activity",
        "USER_ID",
        new Date().toISOString(),
      )
      .run();
    const fetchSpy = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = init?.body as URLSearchParams;
      if (body.get("refresh_token") === "STALE_REFRESH") {
        return new Response('{"errors":[{"errorType":"invalid_grant"}]}', { status: 401 });
      }
      return new Response(JSON.stringify(makeTokenResponse({ access_token: "FROM_SEED" })), {
        status: 200,
      });
    });
    vi.stubGlobal("fetch", fetchSpy);
    const store = new TokenStore(createFakeCtx() as DurableObjectState, env as Env);

    const token = await store.getValidToken();
    expect(token).toBe("FROM_SEED");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const secondCall = fetchSpy.mock.calls[1] as unknown as [unknown, RequestInit];
    expect((secondCall[1].body as URLSearchParams).get("refresh_token")).toBe("seed-refresh-token");
  });

  it("does not retry with the seed when the stored token already is the seed", async () => {
    const env = createFakeEnv();
    await env.DB.prepare(
      `INSERT INTO auth_tokens (id, access_token, refresh_token, expires_at, scope, fitbit_user_id, updated_at)
         VALUES (1, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        "EXPIRED_ACCESS",
        "seed-refresh-token",
        new Date(Date.now() - 60 * 1000).toISOString(),
        "activity",
        "USER_ID",
        new Date().toISOString(),
      )
      .run();
    const fetchSpy = vi.fn(
      async () =>
        new Response('{"errors":[{"errorType":"invalid_grant"}]}', {
          status: 401,
        }),
    );
    vi.stubGlobal("fetch", fetchSpy);
    const store = new TokenStore(createFakeCtx() as DurableObjectState, env as Env);

    await expect(store.getValidToken()).rejects.toThrow(/401/);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("keeps the refreshed token usable even if the D1 mirror write fails", async () => {
    const env = createFakeEnv();
    const originalPrepare = env.DB.prepare.bind(env.DB);
    type PrepareFn = typeof env.DB.prepare;
    (env.DB as unknown as { prepare: PrepareFn }).prepare = ((sql: string) => {
      if (sql.trim().startsWith("INSERT INTO auth_tokens")) {
        return {
          bind: () => ({
            run: async () => {
              throw new Error("D1 unavailable");
            },
          }),
        } as unknown as ReturnType<PrepareFn>;
      }
      return originalPrepare(sql);
    }) as PrepareFn;

    stubTokenFetch(makeTokenResponse({ access_token: "PERSISTED_IN_DO", refresh_token: "RT2" }));
    const ctx = createFakeCtx();
    const store = new TokenStore(ctx as DurableObjectState, env as Env);

    const token = await store.getValidToken();
    expect(token).toBe("PERSISTED_IN_DO");

    const stored = (await ctx.storage.get("token")) as {
      accessToken: string;
      refreshToken: string;
    };
    expect(stored.accessToken).toBe("PERSISTED_IN_DO");
    expect(stored.refreshToken).toBe("RT2");
  });

  it("prefers DO storage over D1 on subsequent calls", async () => {
    const env = createFakeEnv();
    stubTokenFetch(makeTokenResponse({ access_token: "FIRST", refresh_token: "RT2" }));
    const ctx = createFakeCtx();
    const store = new TokenStore(ctx as DurableObjectState, env as Env);

    await store.getValidToken();

    // Tamper with the D1 mirror: if the code still read from D1 it would
    // surface this value. DO storage must take precedence.
    await env.DB.prepare("UPDATE auth_tokens SET access_token = 'D1_TAMPERED' WHERE id = 1").run();

    const token = await store.getValidToken();
    expect(token).toBe("FIRST");
  });
});
