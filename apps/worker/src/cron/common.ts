import { upsertRateLimit } from "../db/rate-limit";
import type { FitbitResponse } from "../fitbit/client";
import type { Env } from "../types";

export async function recordRateLimit<T>(
  env: Env,
  res: FitbitResponse<T>,
): Promise<FitbitResponse<T>> {
  if (res.rateLimit) {
    await upsertRateLimit(env.DB, res.rateLimit);
  }
  return res;
}
