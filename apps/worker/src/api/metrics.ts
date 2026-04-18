import { Hono } from "hono";
import { selectDevices } from "../db/devices";
import { selectRateLimit } from "../db/rate-limit";
import { getToken } from "../db/tokens";
import { selectAllLatest, selectDailyRange, selectLatestDaily } from "../db/vitals";
import { renderExposition } from "../metrics/exposition";
import type { HonoEnv } from "../types";
import { addDays, todayInTimezone } from "../util/time";

export const metricsApp = new Hono<HonoEnv>();

metricsApp.get("/", async (c) => {
  const now = new Date();
  const today = todayInTimezone(c.env.USER_TIMEZONE, now);
  const yesterday = addDays(today, -1);
  const [intradayLatest, dailyLatest, rateLimit, token, sleepRows, devices] = await Promise.all([
    selectAllLatest(c.env.DB),
    selectLatestDaily(c.env.DB),
    selectRateLimit(c.env.DB),
    getToken(c.env.DB),
    selectDailyRange(c.env.DB, "sleep_duration", yesterday, today),
    selectDevices(c.env.DB),
  ]);

  const latestSleep = sleepRows[sleepRows.length - 1];
  const sleepStages = extractSleepStages(latestSleep?.meta ?? null);

  const body = renderExposition({
    now,
    intradayLatest,
    dailyLatest,
    rateLimit,
    token,
    sleepStages,
    devices,
  });
  return c.text(body, 200, { "Content-Type": "text/plain; version=0.0.4" });
});

function extractSleepStages(
  meta: string | null,
): ReadonlyArray<{ stage: string; seconds: number }> {
  if (!meta) return [];
  try {
    const parsed = JSON.parse(meta) as { stages?: Record<string, number> };
    if (!parsed.stages) return [];
    return Object.entries(parsed.stages).map(([stage, seconds]) => ({ stage, seconds }));
  } catch {
    return [];
  }
}
