import { upsertDaily } from "../db/vitals";
import { getCardioScore, getHrv, getSkinTemp, getSleep } from "../fitbit/endpoints";
import { getAccessToken } from "../token-store";
import type { Env } from "../types";
import { findOldestMissingDay } from "../util/backfill";
import { addDays, todayInTimezone } from "../util/time";
import { recordRateLimit } from "./common";

const BACKFILL_DAYS = 30;

export async function runPostWake(env: Env): Promise<void> {
  const token = await getAccessToken(env);
  const today = todayInTimezone(env.USER_TIMEZONE);
  const yesterday = addDays(today, -1);

  await fetchPostWakeDay(env, token, yesterday);

  const missing = await findOldestMissingDay(env.DB, "sleep_duration", BACKFILL_DAYS, today);
  if (missing && missing !== yesterday) {
    await fetchPostWakeDay(env, token, missing);
  }
}

async function fetchPostWakeDay(env: Env, token: string, date: string): Promise<void> {
  const sleep = await recordRateLimit(env, await getSleep(token, date));
  if (sleep.data) {
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

  const hrv = await recordRateLimit(env, await getHrv(token, date));
  if (hrv.data) {
    await upsertDaily(env.DB, date, "hrv_rmssd", hrv.data.dailyRmssd);
    if (hrv.data.deepRmssd !== null) {
      await upsertDaily(env.DB, date, "hrv_deep_rmssd", hrv.data.deepRmssd);
    }
  }

  const skin = await recordRateLimit(env, await getSkinTemp(token, date));
  if (skin.data !== null) {
    await upsertDaily(env.DB, date, "skin_temperature_relative", skin.data);
  }

  const cardio = await recordRateLimit(env, await getCardioScore(token, date));
  if (cardio.data !== null) {
    await upsertDaily(env.DB, date, "cardio_score", cardio.data);
  }
}
