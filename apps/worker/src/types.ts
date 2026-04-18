import type { TokenStore } from "./token-store";

export type Env = {
  readonly DB: D1Database;
  readonly TOKEN_STORE: DurableObjectNamespace<TokenStore>;
  readonly ARCHIVE: R2Bucket;
  readonly USER_TIMEZONE: string;
  readonly FITBIT_CLIENT_ID: string;
  readonly FITBIT_CLIENT_SECRET: string;
  readonly FITBIT_REFRESH_TOKEN_SEED: string;
};

export type HonoEnv = { Bindings: Env };

export type MetricType =
  | "heart_rate"
  | "heart_rate_resting"
  | "hrv_rmssd"
  | "hrv_deep_rmssd"
  | "breathing_rate"
  | "spo2"
  | "skin_temperature_relative"
  | "cardio_score"
  | "steps"
  | "distance"
  | "calories"
  | "floors"
  | "azm_fat_burn"
  | "azm_cardio"
  | "azm_peak"
  | "azm_total"
  | "sleep_duration"
  | "sleep_efficiency"
  | "sleep_score"
  | "sleep_start"
  | "sleep_end"
  | "weight"
  | "body_fat"
  | "bmi";

export type RateLimitSnapshot = {
  readonly limitTotal: number;
  readonly remaining: number;
  readonly resetAt: Date;
};
