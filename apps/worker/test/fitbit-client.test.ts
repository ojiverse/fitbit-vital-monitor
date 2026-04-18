import { afterEach, describe, expect, it, vi } from "vitest";
import { fitbitGet } from "../src/fitbit/client";
import {
  FitbitAuthError,
  FitbitClientError,
  FitbitRateLimitError,
  FitbitServerError,
} from "../src/fitbit/errors";

function mockResponse(
  body: unknown,
  init: { status: number; headers?: Record<string, string> },
): Response {
  const headers = new Headers(init.headers);
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return new Response(text, { status: init.status, headers });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fitbitGet", () => {
  it("returns parsed data and rate limit snapshot on 200", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        mockResponse(
          { ok: true },
          {
            status: 200,
            headers: {
              "fitbit-rate-limit-limit": "150",
              "fitbit-rate-limit-remaining": "140",
              "fitbit-rate-limit-reset": "1200",
            },
          },
        ),
      ),
    );
    const res = await fitbitGet<{ ok: boolean }>("TOKEN", "/ping");
    expect(res.data).toEqual({ ok: true });
    expect(res.rateLimit?.limitTotal).toBe(150);
    expect(res.rateLimit?.remaining).toBe(140);
  });

  it("throws FitbitAuthError on 401", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => mockResponse("auth error", { status: 401 })),
    );
    await expect(fitbitGet("TOKEN", "/x")).rejects.toBeInstanceOf(FitbitAuthError);
  });

  it("throws FitbitRateLimitError on 429", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        mockResponse("rate limited", {
          status: 429,
          headers: {
            "fitbit-rate-limit-limit": "150",
            "fitbit-rate-limit-remaining": "0",
            "fitbit-rate-limit-reset": "60",
          },
        }),
      ),
    );
    await expect(fitbitGet("TOKEN", "/x")).rejects.toBeInstanceOf(FitbitRateLimitError);
  });

  it("throws FitbitServerError on 5xx", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => mockResponse("boom", { status: 502 })),
    );
    await expect(fitbitGet("TOKEN", "/x")).rejects.toBeInstanceOf(FitbitServerError);
  });

  it("throws FitbitClientError on other 4xx", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => mockResponse("bad", { status: 400 })),
    );
    await expect(fitbitGet("TOKEN", "/x")).rejects.toBeInstanceOf(FitbitClientError);
  });
});
