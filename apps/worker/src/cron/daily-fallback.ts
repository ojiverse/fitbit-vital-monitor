import {
  fetchActivity,
  fetchAzm,
  fetchBreathingRate,
  fetchCardioScore,
  fetchHrv,
  fetchSkinTemp,
  fetchSleep,
  fetchSpo2,
  fetchWeight,
} from "../ingest/fetchers";
import { getAccessToken } from "../token-store";
import type { Env } from "../types";
import { findOldestMissingDay } from "../util/backfill";
import { addDays, todayInTimezone } from "../util/time";
import { type CronStep, runSteps } from "./run-steps";

// Sleep-anchored backfill window. Other metrics piggy-back: a single missing
// sleep day on date D implies the wake-up confirmed metrics for D are also
// suspect, so we re-run the full bundle for that date.
const BACKFILL_DAYS = 30;

// Daily fallback for the webhook-first ingestion (DESIGN.md §4.4 / §5).
// Re-fetches yesterday's wake-up confirmed bundle plus today's activity /
// weight as cheap insurance against missed webhook deliveries. Backfills the
// oldest missing sleep day if the 30-day window has a gap.
export async function runDailyFallback(env: Env): Promise<void> {
  const token = await getAccessToken(env);
  const today = todayInTimezone(env.USER_TIMEZONE);
  const yesterday = addDays(today, -1);

  const steps: CronStep[] = [
    ...wakeUpBundleSteps(env, token, yesterday),
    ...todayBundleSteps(env, token, today),
  ];

  try {
    const missing = await findOldestMissingDay(env.DB, "sleep_duration", BACKFILL_DAYS, today);
    if (missing && missing !== yesterday) {
      steps.push(...wakeUpBundleSteps(env, token, missing));
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[cron:daily-fallback] backfill lookup failed: ${msg}`);
  }

  await runSteps("daily-fallback", steps);
}

function wakeUpBundleSteps(env: Env, token: string, date: string): CronStep[] {
  return [
    { name: `sleep[${date}]`, run: () => fetchSleep(env, token, date) },
    { name: `hrv[${date}]`, run: () => fetchHrv(env, token, date) },
    { name: `skin_temp[${date}]`, run: () => fetchSkinTemp(env, token, date) },
    { name: `cardio_score[${date}]`, run: () => fetchCardioScore(env, token, date) },
    { name: `breathing_rate[${date}]`, run: () => fetchBreathingRate(env, token, date) },
    { name: `spo2[${date}]`, run: () => fetchSpo2(env, token, date) },
  ];
}

function todayBundleSteps(env: Env, token: string, date: string): CronStep[] {
  return [
    { name: `activity[${date}]`, run: () => fetchActivity(env, token, date) },
    { name: `azm[${date}]`, run: () => fetchAzm(env, token, date) },
    { name: `weight[${date}]`, run: () => fetchWeight(env, token, date) },
  ];
}
