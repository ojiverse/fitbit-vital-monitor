import { recordRateLimit } from "../cron/common";
import { upsertDevice } from "../db/devices";
import { insertIntradaySamples, upsertDaily } from "../db/vitals";
import {
  getActivitySummary,
  getAzmSummary,
  getBreathingRate,
  getCardioScore,
  getDevices,
  getHeartRateIntraday,
  getHrv,
  getSkinTemp,
  getSleep,
  getSpo2Daily,
  getWeightLog,
} from "../fitbit/endpoints";
import type { Env } from "../types";
import { localToUtcIso } from "../util/time";

export async function fetchSleep(env: Env, token: string, date: string): Promise<void> {
  const sleep = await recordRateLimit(env, await getSleep(token, date));
  if (!sleep.data) return;
  const meta = {
    startIso: sleep.data.startIso,
    endIso: sleep.data.endIso,
    stages: sleep.data.stages,
    segments: sleep.data.segments,
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

export async function fetchHrv(env: Env, token: string, date: string): Promise<void> {
  const hrv = await recordRateLimit(env, await getHrv(token, date));
  if (!hrv.data) return;
  await upsertDaily(env.DB, date, "hrv_rmssd", hrv.data.dailyRmssd);
  if (hrv.data.deepRmssd !== null) {
    await upsertDaily(env.DB, date, "hrv_deep_rmssd", hrv.data.deepRmssd);
  }
}

export async function fetchSkinTemp(env: Env, token: string, date: string): Promise<void> {
  const skin = await recordRateLimit(env, await getSkinTemp(token, date));
  if (skin.data !== null) {
    await upsertDaily(env.DB, date, "skin_temperature_relative", skin.data);
  }
}

export async function fetchCardioScore(env: Env, token: string, date: string): Promise<void> {
  const cardio = await recordRateLimit(env, await getCardioScore(token, date));
  if (cardio.data !== null) {
    await upsertDaily(env.DB, date, "cardio_score", cardio.data);
  }
}

export async function fetchBreathingRate(env: Env, token: string, date: string): Promise<void> {
  const br = await recordRateLimit(env, await getBreathingRate(token, date));
  if (br.data !== null) {
    await upsertDaily(env.DB, date, "breathing_rate", br.data);
  }
}

export async function fetchSpo2(env: Env, token: string, date: string): Promise<void> {
  const spo2 = await recordRateLimit(env, await getSpo2Daily(token, date));
  if (spo2.data !== null) {
    await upsertDaily(env.DB, date, "spo2", spo2.data.avg, {
      min: spo2.data.min,
      max: spo2.data.max,
    });
  }
}

export async function fetchActivity(env: Env, token: string, date: string): Promise<void> {
  const activity = await recordRateLimit(env, await getActivitySummary(token, date));
  await Promise.all([
    upsertDaily(env.DB, date, "steps", activity.data.steps),
    upsertDaily(env.DB, date, "calories", activity.data.calories),
    upsertDaily(env.DB, date, "floors", activity.data.floors),
    upsertDaily(env.DB, date, "distance", activity.data.distanceMeters),
  ]);
}

export async function fetchAzm(env: Env, token: string, date: string): Promise<void> {
  const azm = await recordRateLimit(env, await getAzmSummary(token, date));
  await Promise.all([
    upsertDaily(env.DB, date, "azm_fat_burn", azm.data.fatBurn),
    upsertDaily(env.DB, date, "azm_cardio", azm.data.cardio),
    upsertDaily(env.DB, date, "azm_peak", azm.data.peak),
    upsertDaily(env.DB, date, "azm_total", azm.data.total),
  ]);
}

export async function fetchWeight(env: Env, token: string, date: string): Promise<void> {
  const weight = await recordRateLimit(env, await getWeightLog(token, date));
  if (weight.data) {
    await upsertDaily(env.DB, date, "weight", weight.data.weight);
    if (weight.data.fat !== null) {
      await upsertDaily(env.DB, date, "body_fat", weight.data.fat);
    }
    if (weight.data.bmi !== null) {
      await upsertDaily(env.DB, date, "bmi", weight.data.bmi);
    }
  }
}

export async function fetchHeartIntraday(env: Env, token: string, date: string): Promise<void> {
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

export async function fetchDevices(env: Env, token: string): Promise<void> {
  const devices = await recordRateLimit(env, await getDevices(token));
  for (const d of devices.data) {
    await upsertDevice(env.DB, {
      id: d.id,
      type: d.type,
      batteryLevel: d.batteryLevel,
      lastSyncAt: d.lastSyncTime,
    });
  }
}
