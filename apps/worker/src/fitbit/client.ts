import type { RateLimitSnapshot } from "../types";
import {
  FitbitAuthError,
  FitbitClientError,
  FitbitRateLimitError,
  FitbitServerError,
} from "./errors";

const API_BASE = "https://api.fitbit.com";

export type FitbitResponse<T> = {
  readonly data: T;
  readonly rateLimit: RateLimitSnapshot | null;
};

export async function fitbitGet<T>(accessToken: string, path: string): Promise<FitbitResponse<T>> {
  const url = path.startsWith("http") ? path : `${API_BASE}${path}`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });

  const rateLimit = parseRateLimit(response.headers);

  if (response.ok) {
    const data = (await response.json()) as T;
    return { data, rateLimit };
  }

  const bodyText = await safeReadBody(response);
  const ctx = `${response.status} ${path}`;
  if (response.status === 401) {
    throw new FitbitAuthError(`Fitbit 401 Unauthorized [${path}]: ${bodyText}`);
  }
  if (response.status === 429) {
    const retryAfter = rateLimit
      ? Math.max(1, Math.ceil((rateLimit.resetAt.getTime() - Date.now()) / 1000))
      : 60;
    throw new FitbitRateLimitError(
      `Fitbit 429 Too Many Requests [${path}]: ${bodyText}`,
      retryAfter,
    );
  }
  if (response.status >= 500) {
    throw new FitbitServerError(`Fitbit ${ctx}: ${bodyText}`, response.status);
  }
  throw new FitbitClientError(`Fitbit ${ctx}: ${bodyText}`, response.status);
}

function parseRateLimit(headers: Headers): RateLimitSnapshot | null {
  const limit = headers.get("fitbit-rate-limit-limit");
  const remaining = headers.get("fitbit-rate-limit-remaining");
  const reset = headers.get("fitbit-rate-limit-reset");
  if (limit === null || remaining === null || reset === null) {
    return null;
  }
  const limitTotal = Number(limit);
  const remainingNum = Number(remaining);
  const resetSeconds = Number(reset);
  if (
    !Number.isFinite(limitTotal) ||
    !Number.isFinite(remainingNum) ||
    !Number.isFinite(resetSeconds)
  ) {
    return null;
  }
  return {
    limitTotal,
    remaining: remainingNum,
    resetAt: new Date(Date.now() + resetSeconds * 1000),
  };
}

async function safeReadBody(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "<unreadable body>";
  }
}
