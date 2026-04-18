import { type FitbitResponse, fitbitGet } from "./client";
import {
  activityDailySummarySchema,
  azmIntradaySchema,
  breathingRateSchema,
  cardioScoreSchema,
  devicesSchema,
  heartRateIntradaySchema,
  hrvSchema,
  skinTempSchema,
  sleepSchema,
  spo2DailySchema,
  weightLogSchema,
} from "./schemas";

export type HeartRateIntraday = {
  readonly intraday: ReadonlyArray<{ readonly time: string; readonly value: number }>;
  readonly restingHeartRate: number | null;
};

export type ActivitySummary = {
  readonly steps: number;
  readonly calories: number;
  readonly floors: number;
  readonly distanceMeters: number;
};

export type AzmSummary = {
  readonly fatBurn: number;
  readonly cardio: number;
  readonly peak: number;
  readonly total: number;
};

export type Spo2Summary = {
  readonly avg: number;
  readonly min: number;
  readonly max: number;
};

export type HrvSummary = {
  readonly dailyRmssd: number;
  readonly deepRmssd: number | null;
};

export type SleepSummary = {
  readonly durationSeconds: number;
  readonly efficiency: number;
  readonly startIso: string;
  readonly endIso: string;
  readonly stages: {
    readonly deep: number;
    readonly light: number;
    readonly rem: number;
    readonly wake: number;
  };
};

export type WeightLog = {
  readonly weight: number;
  readonly fat: number | null;
  readonly bmi: number | null;
  readonly observedAt: string;
};

export type DeviceInfo = {
  readonly id: string;
  readonly type: string;
  readonly batteryLevel: number | null;
  readonly lastSyncTime: string;
};

export async function getHeartRateIntraday(
  accessToken: string,
  date: string,
): Promise<FitbitResponse<HeartRateIntraday>> {
  const res = await fitbitGet<unknown>(
    accessToken,
    `/1/user/-/activities/heart/date/${date}/1d/1min.json`,
  );
  const parsed = heartRateIntradaySchema.parse(res.data);
  const daily = parsed["activities-heart"][0];
  return {
    data: {
      intraday: parsed["activities-heart-intraday"].dataset,
      restingHeartRate: daily?.value.restingHeartRate ?? null,
    },
    rateLimit: res.rateLimit,
  };
}

export async function getActivitySummary(
  accessToken: string,
  date: string,
): Promise<FitbitResponse<ActivitySummary>> {
  const res = await fitbitGet<unknown>(accessToken, `/1/user/-/activities/date/${date}.json`);
  const parsed = activityDailySummarySchema.parse(res.data);
  const totalDistance = parsed.summary.distances.find((d) => d.activity === "total");
  return {
    data: {
      steps: parsed.summary.steps,
      calories: parsed.summary.caloriesOut,
      floors: parsed.summary.floors,
      distanceMeters: totalDistance ? Math.round(totalDistance.distance * 1000) : 0,
    },
    rateLimit: res.rateLimit,
  };
}

export async function getAzmSummary(
  accessToken: string,
  date: string,
): Promise<FitbitResponse<AzmSummary>> {
  const res = await fitbitGet<unknown>(
    accessToken,
    `/1/user/-/activities/active-zone-minutes/date/${date}/1d/15min.json`,
  );
  const parsed = azmIntradaySchema.parse(res.data);
  const entry = parsed["activities-active-zone-minutes"][0]?.value ?? {};
  const fatBurn = entry.fatBurnActiveZoneMinutes ?? 0;
  const cardio = entry.cardioActiveZoneMinutes ?? 0;
  const peak = entry.peakActiveZoneMinutes ?? 0;
  return {
    data: {
      fatBurn,
      cardio,
      peak,
      total: entry.activeZoneMinutes ?? fatBurn + cardio + peak,
    },
    rateLimit: res.rateLimit,
  };
}

export async function getBreathingRate(
  accessToken: string,
  date: string,
): Promise<FitbitResponse<number | null>> {
  const res = await fitbitGet<unknown>(accessToken, `/1/user/-/br/date/${date}.json`);
  const parsed = breathingRateSchema.parse(res.data);
  return { data: parsed.br[0]?.value.breathingRate ?? null, rateLimit: res.rateLimit };
}

export async function getSpo2Daily(
  accessToken: string,
  date: string,
): Promise<FitbitResponse<Spo2Summary | null>> {
  const res = await fitbitGet<unknown>(accessToken, `/1/user/-/spo2/date/${date}.json`);
  const parsed = spo2DailySchema.parse(res.data);
  const entry = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!entry) return { data: null, rateLimit: res.rateLimit };
  return { data: entry.value, rateLimit: res.rateLimit };
}

export async function getHrv(
  accessToken: string,
  date: string,
): Promise<FitbitResponse<HrvSummary | null>> {
  const res = await fitbitGet<unknown>(accessToken, `/1/user/-/hrv/date/${date}.json`);
  const parsed = hrvSchema.parse(res.data);
  const entry = parsed.hrv[0];
  if (!entry) return { data: null, rateLimit: res.rateLimit };
  return {
    data: {
      dailyRmssd: entry.value.dailyRmssd,
      deepRmssd: entry.value.deepRmssd ?? null,
    },
    rateLimit: res.rateLimit,
  };
}

export async function getSkinTemp(
  accessToken: string,
  date: string,
): Promise<FitbitResponse<number | null>> {
  const res = await fitbitGet<unknown>(accessToken, `/1/user/-/temp/skin/date/${date}.json`);
  const parsed = skinTempSchema.parse(res.data);
  return { data: parsed.tempSkin[0]?.value.nightlyRelative ?? null, rateLimit: res.rateLimit };
}

export async function getCardioScore(
  accessToken: string,
  date: string,
): Promise<FitbitResponse<number | null>> {
  const res = await fitbitGet<unknown>(accessToken, `/1/user/-/cardioscore/date/${date}.json`);
  const parsed = cardioScoreSchema.parse(res.data);
  const raw = parsed.cardioScore[0]?.value.vo2Max;
  if (raw === undefined) return { data: null, rateLimit: res.rateLimit };
  if (typeof raw === "number") return { data: raw, rateLimit: res.rateLimit };
  const match = raw.match(/(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)/);
  if (match?.[1] && match[2]) {
    const lo = Number(match[1]);
    const hi = Number(match[2]);
    return { data: (lo + hi) / 2, rateLimit: res.rateLimit };
  }
  const single = Number(raw);
  return {
    data: Number.isFinite(single) ? single : null,
    rateLimit: res.rateLimit,
  };
}

export async function getSleep(
  accessToken: string,
  date: string,
): Promise<FitbitResponse<SleepSummary | null>> {
  const res = await fitbitGet<unknown>(accessToken, `/1.2/user/-/sleep/date/${date}.json`);
  const parsed = sleepSchema.parse(res.data);
  const main = parsed.sleep.find((s) => s.isMainSleep) ?? parsed.sleep[0];
  if (!main) return { data: null, rateLimit: res.rateLimit };
  const stages = main.levels?.summary ?? {};
  return {
    data: {
      durationSeconds: Math.round(main.duration / 1000),
      efficiency: main.efficiency,
      startIso: main.startTime,
      endIso: main.endTime,
      stages: {
        deep: (stages.deep?.minutes ?? 0) * 60,
        light: (stages.light?.minutes ?? 0) * 60,
        rem: (stages.rem?.minutes ?? 0) * 60,
        wake: (stages.wake?.minutes ?? 0) * 60,
      },
    },
    rateLimit: res.rateLimit,
  };
}

export async function getWeightLog(
  accessToken: string,
  date: string,
): Promise<FitbitResponse<WeightLog | null>> {
  const res = await fitbitGet<unknown>(accessToken, `/1/user/-/body/log/weight/date/${date}.json`);
  const parsed = weightLogSchema.parse(res.data);
  const last = parsed.weight[parsed.weight.length - 1];
  if (!last) return { data: null, rateLimit: res.rateLimit };
  return {
    data: {
      weight: last.weight,
      fat: last.fat ?? null,
      bmi: last.bmi ?? null,
      observedAt: last.time ? `${last.date}T${last.time}` : last.date,
    },
    rateLimit: res.rateLimit,
  };
}

export async function getDevices(
  accessToken: string,
): Promise<FitbitResponse<ReadonlyArray<DeviceInfo>>> {
  const res = await fitbitGet<unknown>(accessToken, "/1/user/-/devices.json");
  const parsed = devicesSchema.parse(res.data);
  return {
    data: parsed.map((d) => ({
      id: d.id,
      type: d.type,
      batteryLevel: d.batteryLevel ?? null,
      lastSyncTime: d.lastSyncTime,
    })),
    rateLimit: res.rateLimit,
  };
}
