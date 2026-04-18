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
});
