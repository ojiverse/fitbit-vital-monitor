import { afterEach, describe, expect, it, vi } from "vitest";
import { fitbitGet } from "../src/fitbit/client";
import { FitbitRateLimitError } from "../src/fitbit/errors";

afterEach(() => vi.restoreAllMocks());

function respond(
  body: unknown,
  init: { status: number; headers?: Record<string, string> },
): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status: init.status,
    headers: init.headers ?? {},
  });
}

describe("fitbitGet header handling", () => {
  it("returns null rateLimit when headers are missing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => respond({ ok: true }, { status: 200 })),
    );
    const res = await fitbitGet<{ ok: boolean }>("T", "/x");
    expect(res.rateLimit).toBeNull();
  });

  it("returns null rateLimit when a header is non-numeric", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        respond(
          { ok: true },
          {
            status: 200,
            headers: {
              "fitbit-rate-limit-limit": "abc",
              "fitbit-rate-limit-remaining": "10",
              "fitbit-rate-limit-reset": "60",
            },
          },
        ),
      ),
    );
    const res = await fitbitGet<{ ok: boolean }>("T", "/x");
    expect(res.rateLimit).toBeNull();
  });

  it("infers retryAfter from rate-limit reset on 429", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        respond("rate limited", {
          status: 429,
          headers: {
            "fitbit-rate-limit-limit": "150",
            "fitbit-rate-limit-remaining": "0",
            "fitbit-rate-limit-reset": "42",
          },
        }),
      ),
    );
    const err = await fitbitGet<unknown>("T", "/x").catch((e) => e);
    expect(err).toBeInstanceOf(FitbitRateLimitError);
    expect((err as FitbitRateLimitError).retryAfterSeconds).toBeGreaterThan(0);
    expect((err as FitbitRateLimitError).retryAfterSeconds).toBeLessThanOrEqual(42);
  });

  it("defaults retryAfter to 60 when no rate-limit headers are present", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => respond("rate limited", { status: 429 })),
    );
    const err = await fitbitGet<unknown>("T", "/x").catch((e) => e);
    expect(err).toBeInstanceOf(FitbitRateLimitError);
    expect((err as FitbitRateLimitError).retryAfterSeconds).toBe(60);
  });

  it("sends Bearer authorization and Accept JSON headers", async () => {
    const fetchSpy = vi.fn(async () => respond({ ok: true }, { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
    await fitbitGet<{ ok: boolean }>("my-token", "/ping");
    const call = fetchSpy.mock.calls[0];
    expect(call).toBeDefined();
    const [url, init] = call as unknown as [string, RequestInit];
    expect(url).toBe("https://api.fitbit.com/ping");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer my-token");
    expect(headers.Accept).toBe("application/json");
  });

  it("accepts fully-qualified URLs without prepending API base", async () => {
    const fetchSpy = vi.fn(async () => respond({ ok: true }, { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
    await fitbitGet<{ ok: boolean }>("T", "https://example.com/custom");
    const call = fetchSpy.mock.calls[0];
    expect(call).toBeDefined();
    const [url] = call as unknown as [string, RequestInit];
    expect(url).toBe("https://example.com/custom");
  });
});
