import { upsertDaily } from "../db/vitals";
import { getCardioScore, getHrv, getSkinTemp, getSleep } from "../fitbit/endpoints";
import { getAccessToken } from "../token-store";
import type { Env } from "../types";
import { findOldestMissingDay } from "../util/backfill";
import { addDays, todayInTimezone } from "../util/time";
import { recordRateLimit } from "./common";
import { type CronStep, runSteps } from "./run-steps";

const BACKFILL_DAYS = 30;

export async function runPostWake(env: Env): Promise<void> {
  const token = await getAccessToken(env);
  const today = todayInTimezone(env.USER_TIMEZONE);
  const yesterday = addDays(today, -1);

  const steps: CronStep[] = [...postWakeDaySteps(env, token, yesterday)];

  try {
    const missing = await findOldestMissingDay(env.DB, "sleep_duration", BACKFILL_DAYS, today);
    if (missing && missing !== yesterday) {
      steps.push(...postWakeDaySteps(env, token, missing));
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[cron:post-wake] backfill lookup failed: ${msg}`);
  }

  await runSteps("post-wake", steps);
}

function postWakeDaySteps(env: Env, token: string, date: string): CronStep[] {
  return [
    { name: `sleep[${date}]`, run: () => fetchSleep(env, token, date) },
    { name: `hrv[${date}]`, run: () => fetchHrv(env, token, date) },
    { name: `skin_temp[${date}]`, run: () => fetchSkinTemp(env, token, date) },
    { name: `cardio_score[${date}]`, run: () => fetchCardioScore(env, token, date) },
  ];
}

async function fetchSleep(env: Env, token: string, date: string): Promise<void> {
  const sleep = await recordRateLimit(env, await getSleep(token, date));
  if (!sleep.data) return;
  const meta = {
    startIso: sleep.data.startIso,
    endIso: sleep.data.endIso,
    stages: sleep.data.stages,
  };
  await upsertDaily(env.DB, date, "sleep_duration", sleep.data.durationSeconds, meta);
  await upsertDaily(env.DB, date, "sleep_efficiency", sleep.data.efficiency);
  await upsertDaily(
    env.DB,
    date,
    "sleep_start",
    Math.round(Date.parse(sleep.data.startIso) / 1000),
  );
  await upsertDaily(env.DB, date, "sleep_end", Math.round(Date.parse(sleep.data.endIso) / 1000));
}

async function fetchHrv(env: Env, token: string, date: string): Promise<void> {
  const hrv = await recordRateLimit(env, await getHrv(token, date));
  if (!hrv.data) return;
  await upsertDaily(env.DB, date, "hrv_rmssd", hrv.data.dailyRmssd);
  if (hrv.data.deepRmssd !== null) {
    await upsertDaily(env.DB, date, "hrv_deep_rmssd", hrv.data.deepRmssd);
  }
}

async function fetchSkinTemp(env: Env, token: string, date: string): Promise<void> {
  const skin = await recordRateLimit(env, await getSkinTemp(token, date));
  if (skin.data !== null) {
    await upsertDaily(env.DB, date, "skin_temperature_relative", skin.data);
  }
}

async function fetchCardioScore(env: Env, token: string, date: string): Promise<void> {
  const cardio = await recordRateLimit(env, await getCardioScore(token, date));
  if (cardio.data !== null) {
    await upsertDaily(env.DB, date, "cardio_score", cardio.data);
  }
}
