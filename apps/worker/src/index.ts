import { Hono } from "hono";
import { cors } from "hono/cors";
import { metricsApp } from "./api/metrics";
import { vitalsApp } from "./api/vitals";
import { dispatchCron } from "./cron";
import type { Env, HonoEnv } from "./types";

export { TokenStore } from "./token-store";

const app = new Hono<HonoEnv>();

app.use("*", cors({ origin: "*" }));

app.get("/healthz", (c) => c.text("ok"));
app.route("/api/vitals", vitalsApp);
app.route("/metrics", metricsApp);

export default {
  fetch: app.fetch,
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(dispatchCron(controller.cron, env));
  },
} satisfies ExportedHandler<Env>;
