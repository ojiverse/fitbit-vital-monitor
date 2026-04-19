import { Hono } from "hono";
import { cors } from "hono/cors";
import { metricsApp } from "./api/metrics";
import { vitalsApp } from "./api/vitals";
import { webhookApp } from "./api/webhook";
import { dispatchCron } from "./cron";
import type { Env, HonoEnv } from "./types";

export { TokenStore } from "./token-store";

const app = new Hono<HonoEnv>();

// CORS only applies to the read-only browser/Prometheus endpoints. The
// webhook is a server-to-server callback signed by Fitbit; CORS is irrelevant
// and we don't want preflight handling for it.
app.use("/api/*", cors({ origin: "*" }));
app.use("/metrics", cors({ origin: "*" }));

app.get("/healthz", (c) => c.text("ok"));
app.route("/api/vitals", vitalsApp);
app.route("/metrics", metricsApp);
app.route("/webhook/fitbit", webhookApp);

export default {
  fetch: app.fetch,
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(dispatchCron(controller.cron, env));
  },
} satisfies ExportedHandler<Env>;
