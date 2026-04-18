import { upsertDevice } from "../db/devices";
import { upsertDaily } from "../db/vitals";
import { getBreathingRate, getDevices, getSpo2Daily } from "../fitbit/endpoints";
import { getAccessToken } from "../token-store";
import type { Env } from "../types";
import { todayInTimezone } from "../util/time";
import { recordRateLimit } from "./common";
import { runSteps } from "./run-steps";

export async function runHourly(env: Env): Promise<void> {
  const token = await getAccessToken(env);
  const date = todayInTimezone(env.USER_TIMEZONE);

  await runSteps("hourly", [
    { name: "breathing_rate", run: () => fetchBreathingRate(env, token, date) },
    { name: "spo2_daily", run: () => fetchSpo2(env, token, date) },
    { name: "devices", run: () => fetchDevices(env, token) },
  ]);
}

async function fetchBreathingRate(env: Env, token: string, date: string): Promise<void> {
  const br = await recordRateLimit(env, await getBreathingRate(token, date));
  if (br.data !== null) {
    await upsertDaily(env.DB, date, "breathing_rate", br.data);
  }
}

async function fetchSpo2(env: Env, token: string, date: string): Promise<void> {
  const spo2 = await recordRateLimit(env, await getSpo2Daily(token, date));
  if (spo2.data !== null) {
    await upsertDaily(env.DB, date, "spo2", spo2.data.avg, {
      min: spo2.data.min,
      max: spo2.data.max,
    });
  }
}

async function fetchDevices(env: Env, token: string): Promise<void> {
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
