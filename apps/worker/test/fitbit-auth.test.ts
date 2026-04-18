import { afterEach, describe, expect, it, vi } from "vitest";
import { refreshAccessToken } from "../src/fitbit/auth";
import { FitbitAuthError, FitbitClientError, FitbitServerError } from "../src/fitbit/errors";

function stubFetch(
  body: unknown,
  init: { status: number; headers?: Record<string, string> } = { status: 200 },
): void {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(text, { status: init.status, headers: init.headers ?? {} })),
  );
}

afterEach(() => vi.restoreAllMocks());

describe("refreshAccessToken", () => {
  it("exchanges a refresh token and parses the response", async () => {
    stubFetch({
      access_token: "A",
      refresh_token: "R2",
      expires_in: 28800,
      scope: "activity heartrate",
      token_type: "Bearer",
      user_id: "U",
    });
    const result = await refreshAccessToken("ci", "cs", "R1");
    expect(result.access_token).toBe("A");
    expect(result.refresh_token).toBe("R2");
    expect(result.expires_in).toBe(28800);
    expect(result.user_id).toBe("U");
  });

  it("sends basic auth with client id/secret and form-encoded refresh_token", async () => {
    const fetchSpy = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            access_token: "A",
            refresh_token: "R",
            expires_in: 100,
            scope: "x",
            token_type: "Bearer",
            user_id: "U",
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchSpy);
    await refreshAccessToken("id", "secret", "refresh-xyz");
    const call = fetchSpy.mock.calls[0];
    expect(call).toBeDefined();
    const init = (call as unknown as [unknown, RequestInit])[1];
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Basic ${btoa("id:secret")}`);
    expect(headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    const body = init.body as URLSearchParams;
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("refresh-xyz");
  });

  it("throws FitbitAuthError on 401 / 403", async () => {
    stubFetch("bad refresh", { status: 401 });
    await expect(refreshAccessToken("a", "b", "r")).rejects.toBeInstanceOf(FitbitAuthError);
    stubFetch("forbidden", { status: 403 });
    await expect(refreshAccessToken("a", "b", "r")).rejects.toBeInstanceOf(FitbitAuthError);
  });

  it("throws FitbitServerError on 5xx", async () => {
    stubFetch("boom", { status: 502 });
    await expect(refreshAccessToken("a", "b", "r")).rejects.toBeInstanceOf(FitbitServerError);
  });

  it("throws FitbitClientError on other 4xx", async () => {
    stubFetch("bad", { status: 400 });
    await expect(refreshAccessToken("a", "b", "r")).rejects.toBeInstanceOf(FitbitClientError);
  });
});
