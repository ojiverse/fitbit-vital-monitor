import { Hono } from "hono";
import { z } from "zod";
import { selectDevices } from "../db/devices";
import {
  selectAllLatest,
  selectDailyRange,
  selectIntradayByDate,
  selectLatestDaily,
} from "../db/vitals";
import type { HonoEnv } from "../types";
import { addDays } from "../util/time";

export const vitalsApp = new Hono<HonoEnv>();

vitalsApp.get("/latest", async (c) => {
  const [intraday, daily, devices] = await Promise.all([
    selectAllLatest(c.env.DB),
    selectLatestDaily(c.env.DB),
    selectDevices(c.env.DB),
  ]);
  return c.json({ intraday, daily, devices });
});

const dailyQuery = z.object({
  metric: z.string().min(1),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

vitalsApp.get("/daily", async (c) => {
  const parsed = dailyQuery.safeParse({
    metric: c.req.query("metric"),
    from: c.req.query("from"),
    to: c.req.query("to"),
  });
  if (!parsed.success) {
    return c.json({ error: "invalid_query", issues: parsed.error.issues }, 400);
  }
  const rows = await selectDailyRange(
    c.env.DB,
    parsed.data.metric,
    parsed.data.from,
    parsed.data.to,
  );
  return c.json({ metric: parsed.data.metric, points: rows });
});

const intradayQuery = z.object({
  metric: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

vitalsApp.get("/intraday", async (c) => {
  const parsed = intradayQuery.safeParse({
    metric: c.req.query("metric"),
    date: c.req.query("date"),
  });
  if (!parsed.success) {
    return c.json({ error: "invalid_query", issues: parsed.error.issues }, 400);
  }
  const { metric, date } = parsed.data;
  const from = `${date}T00:00:00.000Z`;
  const to = `${addDays(date, 1)}T00:00:00.000Z`;
  const rows = await selectIntradayByDate(c.env.DB, metric, from, to);
  return c.json({ metric, date, points: rows });
});
