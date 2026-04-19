import type { CronStep } from "../cron/run-steps";
import type { Env } from "../types";
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
} from "./fetchers";

// Subscription collections we care about. `foods` is intentionally omitted —
// the project does not track nutrition (see metrics.md §6.3).
export type SubscriptionCollection = "sleep" | "activities" | "body";

// Build the fetch steps for a Subscription notification. The `sleep` group
// includes wake-up confirmed metrics (HRV / skin temp / cardio score /
// breathing rate / SpO2) that have no Subscription of their own but are
// finalized at the same moment as the sleep log — see DESIGN.md §4.4.
export function buildWebhookSteps(
  env: Env,
  token: string,
  collection: SubscriptionCollection,
  date: string,
): CronStep[] {
  switch (collection) {
    case "sleep":
      return [
        { name: `sleep[${date}]`, run: () => fetchSleep(env, token, date) },
        { name: `hrv[${date}]`, run: () => fetchHrv(env, token, date) },
        { name: `skin_temp[${date}]`, run: () => fetchSkinTemp(env, token, date) },
        { name: `cardio_score[${date}]`, run: () => fetchCardioScore(env, token, date) },
        { name: `breathing_rate[${date}]`, run: () => fetchBreathingRate(env, token, date) },
        { name: `spo2[${date}]`, run: () => fetchSpo2(env, token, date) },
      ];
    case "activities":
      return [
        { name: `activity[${date}]`, run: () => fetchActivity(env, token, date) },
        { name: `azm[${date}]`, run: () => fetchAzm(env, token, date) },
      ];
    case "body":
      return [{ name: `weight[${date}]`, run: () => fetchWeight(env, token, date) }];
  }
}
