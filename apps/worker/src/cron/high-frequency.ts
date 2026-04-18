import { insertIntradaySamples, upsertDaily } from "../db/vitals";
import { getActivitySummary, getAzmSummary, getHeartRateIntraday } from "../fitbit/endpoints";
import { getAccessToken } from "../token-store";
import type { Env } from "../types";
import { localToUtcIso, todayInTimezone } from "../util/time";
import { recordRateLimit } from "./common";
import { runSteps } from "./run-steps";

export async function runHighFrequency(env: Env): Promise<void> {
  const token = await getAccessToken(env);
  const date = todayInTimezone(env.USER_TIMEZONE);

  await runSteps("high-frequency", [
    { name: "heart_rate_intraday", run: () => fetchHeart(env, token, date) },
    { name: "activity_summary", run: () => fetchActivity(env, token, date) },
    { name: "azm_summary", run: () => fetchAzm(env, token, date) },
  ]);
}

async function fetchHeart(env: Env, token: string, date: string): Promise<void> {
  const heart = await recordRateLimit(env, await getHeartRateIntraday(token, date));
  await insertIntradaySamples(
    env.DB,
    heart.data.intraday.map((p) => ({
      timestamp: localToUtcIso(date, p.time, env.USER_TIMEZONE),
      metricType: "heart_rate",
      value: p.value,
    })),
  );
  if (heart.data.restingHeartRate !== null) {
    await upsertDaily(env.DB, date, "heart_rate_resting", heart.data.restingHeartRate);
  }
}

async function fetchActivity(env: Env, token: string, date: string): Promise<void> {
  const activity = await recordRateLimit(env, await getActivitySummary(token, date));
  await Promise.all([
    upsertDaily(env.DB, date, "steps", activity.data.steps),
    upsertDaily(env.DB, date, "calories", activity.data.calories),
    upsertDaily(env.DB, date, "floors", activity.data.floors),
    upsertDaily(env.DB, date, "distance", activity.data.distanceMeters),
  ]);
}

async function fetchAzm(env: Env, token: string, date: string): Promise<void> {
  const azm = await recordRateLimit(env, await getAzmSummary(token, date));
  await Promise.all([
    upsertDaily(env.DB, date, "azm_fat_burn", azm.data.fatBurn),
    upsertDaily(env.DB, date, "azm_cardio", azm.data.cardio),
    upsertDaily(env.DB, date, "azm_peak", azm.data.peak),
    upsertDaily(env.DB, date, "azm_total", azm.data.total),
  ]);
}
