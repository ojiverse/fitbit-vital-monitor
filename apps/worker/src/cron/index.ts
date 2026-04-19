import type { Env } from "../types";
import { runBody } from "./body";
import { runDailyFallback } from "./daily-fallback";
import { runHighFrequency } from "./high-frequency";
import { runHourly } from "./hourly";

export async function dispatchCron(cron: string, env: Env): Promise<void> {
  switch (cron) {
    case "*/15 * * * *":
      await runHighFrequency(env);
      return;
    case "0 * * * *":
      await runHourly(env);
      return;
    case "0 23 * * *":
      await runDailyFallback(env);
      return;
    case "0 */4 * * *":
      await runBody(env);
      return;
    default:
      console.warn("Unknown cron schedule", cron);
  }
}
