import { upsertDaily } from "../db/vitals";
import { getWeightLog } from "../fitbit/endpoints";
import { getAccessToken } from "../token-store";
import type { Env } from "../types";
import { todayInTimezone } from "../util/time";
import { runArchive } from "./archive";
import { recordRateLimit } from "./common";
import { runSteps } from "./run-steps";

export async function runBody(env: Env): Promise<void> {
  const token = await getAccessToken(env);
  const date = todayInTimezone(env.USER_TIMEZONE);

  await runSteps("body", [
    { name: "weight_log", run: () => fetchWeight(env, token, date) },
    { name: "archive", run: () => runArchive(env) },
  ]);
}

async function fetchWeight(env: Env, token: string, date: string): Promise<void> {
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
