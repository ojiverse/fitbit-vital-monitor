import type { DeviceRow } from "../db/devices";
import type { StoredToken } from "../db/tokens";
import type { LatestSample } from "../db/vitals";
import type { RateLimitSnapshot } from "../types";

type Labels = Readonly<Record<string, string>>;
type MetricDef = {
  readonly name: string;
  readonly help: string;
  readonly labels?: Labels;
};

const INTRADAY_METRICS: Readonly<Record<string, MetricDef>> = {
  heart_rate: {
    name: "fitbit_heart_rate_bpm",
    help: "Current heart rate (bpm) from the most recent intraday sample.",
  },
};

const DAILY_METRICS: Readonly<Record<string, MetricDef>> = {
  heart_rate_resting: {
    name: "fitbit_heart_rate_resting_bpm",
    help: "Resting heart rate (bpm) from the latest daily summary.",
  },
  hrv_rmssd: {
    name: "fitbit_hrv_rmssd_milliseconds",
    help: "Daily RMSSD heart rate variability (ms).",
  },
  hrv_deep_rmssd: {
    name: "fitbit_hrv_deep_rmssd_milliseconds",
    help: "Deep-sleep RMSSD heart rate variability (ms).",
  },
  breathing_rate: {
    name: "fitbit_breathing_rate_per_minute",
    help: "Breaths per minute during sleep.",
  },
  spo2: {
    name: "fitbit_spo2_percent",
    help: "Blood oxygen saturation (%) during sleep.",
  },
  skin_temperature_relative: {
    name: "fitbit_skin_temperature_relative_celsius",
    help: "Nightly relative skin temperature deviation from baseline (°C).",
  },
  cardio_score: {
    name: "fitbit_cardio_score",
    help: "VO2 Max / cardio fitness score (0-100).",
  },
  steps: { name: "fitbit_steps_today", help: "Steps accumulated today." },
  distance: { name: "fitbit_distance_today_meters", help: "Distance covered today (m)." },
  calories: { name: "fitbit_calories_today", help: "Calories burned today (kcal)." },
  floors: { name: "fitbit_floors_today", help: "Floors climbed today." },
  azm_fat_burn: {
    name: "fitbit_active_zone_minutes_today",
    help: "Active Zone Minutes accumulated today.",
    labels: { zone: "fat_burn" },
  },
  azm_cardio: {
    name: "fitbit_active_zone_minutes_today",
    help: "Active Zone Minutes accumulated today.",
    labels: { zone: "cardio" },
  },
  azm_peak: {
    name: "fitbit_active_zone_minutes_today",
    help: "Active Zone Minutes accumulated today.",
    labels: { zone: "peak" },
  },
  azm_total: {
    name: "fitbit_active_zone_minutes_today",
    help: "Active Zone Minutes accumulated today.",
    labels: { zone: "total" },
  },
  sleep_duration: {
    name: "fitbit_sleep_duration_seconds",
    help: "Duration of the last main sleep session (s).",
  },
  sleep_efficiency: {
    name: "fitbit_sleep_efficiency_percent",
    help: "Sleep efficiency (%) of the last main sleep session.",
  },
  sleep_start: {
    name: "fitbit_sleep_start_timestamp_seconds",
    help: "Unix timestamp of the last main sleep start.",
  },
  sleep_end: {
    name: "fitbit_sleep_end_timestamp_seconds",
    help: "Unix timestamp of the last main sleep end.",
  },
  weight: { name: "fitbit_weight_kilograms", help: "Most recent measured weight (kg)." },
  body_fat: { name: "fitbit_body_fat_percent", help: "Most recent body fat percentage." },
  bmi: { name: "fitbit_bmi", help: "Most recent BMI." },
};

export type ExpositionInput = {
  readonly now: Date;
  readonly intradayLatest: ReadonlyArray<LatestSample>;
  readonly dailyLatest: ReadonlyArray<LatestSample>;
  readonly rateLimit: RateLimitSnapshot | null;
  readonly token: StoredToken | null;
  readonly sleepStages: ReadonlyArray<{ readonly stage: string; readonly seconds: number }>;
  readonly devices: ReadonlyArray<DeviceRow>;
};

export function renderExposition(input: ExpositionInput): string {
  const groups = new Map<string, { help: string; lines: string[] }>();
  const emit = (def: MetricDef, value: number, extraLabels?: Labels): void => {
    const group = groups.get(def.name) ?? { help: def.help, lines: [] };
    const labels = { ...(def.labels ?? {}), ...(extraLabels ?? {}) };
    group.lines.push(`${def.name}${formatLabels(labels)} ${formatValue(value)}`);
    groups.set(def.name, group);
  };

  for (const row of input.intradayLatest) {
    const def = INTRADAY_METRICS[row.metricType];
    if (def) emit(def, row.value);
  }
  for (const row of input.dailyLatest) {
    const def = DAILY_METRICS[row.metricType];
    if (def) emit(def, row.value);
  }

  for (const stage of input.sleepStages) {
    emit(
      {
        name: "fitbit_sleep_stage_seconds",
        help: "Seconds spent in each sleep stage during the last main sleep.",
      },
      stage.seconds,
      { stage: stage.stage },
    );
  }

  if (input.rateLimit) {
    emit(
      {
        name: "fitbit_api_rate_limit_remaining",
        help: "Remaining Fitbit API requests in the current window.",
      },
      input.rateLimit.remaining,
    );
    emit(
      {
        name: "fitbit_api_rate_limit_total",
        help: "Total Fitbit API requests allowed in the current window.",
      },
      input.rateLimit.limitTotal,
    );
    emit(
      {
        name: "fitbit_api_rate_limit_reset_seconds",
        help: "Seconds until the Fitbit rate-limit window resets.",
      },
      Math.max(0, Math.round((input.rateLimit.resetAt.getTime() - input.now.getTime()) / 1000)),
    );
  }

  if (input.token) {
    emit(
      {
        name: "fitbit_token_expires_at_timestamp_seconds",
        help: "Unix timestamp when the current access_token expires.",
      },
      Math.round(input.token.expiresAt.getTime() / 1000),
    );
  }

  const batteryDef: MetricDef = {
    name: "fitbit_device_battery_percent",
    help: "Reported battery level (%) for each linked Fitbit device.",
  };
  const lastSyncDef: MetricDef = {
    name: "fitbit_device_last_sync_timestamp_seconds",
    help: "Unix timestamp of the last sync for each linked Fitbit device.",
  };
  for (const device of input.devices) {
    const labels = { device_id: device.id, device_type: device.type };
    if (device.batteryLevel !== null) {
      emit(batteryDef, device.batteryLevel, labels);
    }
    emit(lastSyncDef, Math.round(Date.parse(device.lastSyncAt) / 1000), labels);
  }

  const freshnessDef: MetricDef = {
    name: "fitbit_data_freshness_seconds",
    help: "Seconds since the most recent sample for a given metric was observed.",
  };
  for (const row of input.intradayLatest) {
    const metricDef = INTRADAY_METRICS[row.metricType];
    if (!metricDef) continue;
    const age = Math.max(0, Math.round((input.now.getTime() - Date.parse(row.timestamp)) / 1000));
    emit(freshnessDef, age, { metric: row.metricType });
  }
  for (const row of input.dailyLatest) {
    const metricDef = DAILY_METRICS[row.metricType];
    if (!metricDef) continue;
    const age = Math.max(
      0,
      Math.round((input.now.getTime() - Date.parse(`${row.timestamp}T00:00:00Z`)) / 1000),
    );
    emit(freshnessDef, age, { metric: row.metricType });
  }

  const out: string[] = [];
  for (const [name, group] of groups) {
    out.push(`# HELP ${name} ${group.help}`);
    out.push(`# TYPE ${name} gauge`);
    out.push(...group.lines);
  }
  return `${out.join("\n")}\n`;
}

function formatLabels(labels: Labels): string {
  const keys = Object.keys(labels);
  if (keys.length === 0) return "";
  const parts = keys.map((k) => `${k}="${escapeLabel(labels[k] ?? "")}"`);
  return `{${parts.join(",")}}`;
}

function escapeLabel(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/"/g, '\\"');
}

function formatValue(v: number): string {
  if (!Number.isFinite(v)) return "NaN";
  return Number.isInteger(v) ? v.toString() : v.toString();
}
