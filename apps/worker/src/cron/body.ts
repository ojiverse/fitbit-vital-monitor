import { upsertDaily } from "../db/vitals";
import { getWeightLog } from "../fitbit/endpoints";
import { getAccessToken } from "../token-store";
import type { Env } from "../types";
import { todayInTimezone } from "../util/time";
import { runArchive } from "./archive";
import { recordRateLimit } from "./common";

export async function runBody(env: Env): Promise<void> {
  const token = await getAccessToken(env);
  const date = todayInTimezone(env.USER_TIMEZONE);

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

  await runArchive(env);
}
