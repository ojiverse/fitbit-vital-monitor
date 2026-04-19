import { fetchHeartIntraday } from "../ingest/fetchers";
import { getAccessToken } from "../token-store";
import type { Env } from "../types";
import { findOldestMissingIntradayDay } from "../util/backfill";
import { todayInTimezone } from "../util/time";
import { type CronStep, runSteps } from "./run-steps";

// Matches the 7-day intraday retention window. Days older than this are archived
// to R2 and permanently absent from the `vitals` table, so backfill cannot help.
const BACKFILL_DAYS = 7;

// Heart rate intraday is the only metric not covered by Fitbit Subscription
// (DESIGN.md §4.4), so this cron remains a primary ingestion path.
export async function runHighFrequency(env: Env): Promise<void> {
  const token = await getAccessToken(env);
  const today = todayInTimezone(env.USER_TIMEZONE);

  const steps: CronStep[] = [
    { name: "heart_rate_intraday", run: () => fetchHeartIntraday(env, token, today) },
  ];

  try {
    const missing = await findOldestMissingIntradayDay(
      env.DB,
      "heart_rate",
      BACKFILL_DAYS,
      today,
      env.USER_TIMEZONE,
    );
    if (missing) {
      steps.push({
        name: `heart_rate_intraday[${missing}]`,
        run: () => fetchHeartIntraday(env, token, missing),
      });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[cron:high-frequency] backfill lookup failed: ${msg}`);
  }

  await runSteps("high-frequency", steps);
}
