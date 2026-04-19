import { Hono } from "hono";
import { z } from "zod";
import { runSteps } from "../cron/run-steps";
import { verifyFitbitSignature } from "../fitbit/webhook-signature";
import { type SubscriptionCollection, buildWebhookSteps } from "../ingest/groups";
import { getAccessToken } from "../token-store";
import type { Env, HonoEnv } from "../types";
import { addDays, todayInTimezone } from "../util/time";

export const webhookApp = new Hono<HonoEnv>();

const notificationSchema = z.array(
  z.object({
    collectionType: z.string(),
    ownerId: z.string().optional(),
    ownerType: z.string().optional(),
    subscriptionId: z.string().optional(),
    date: z.string().optional(),
  }),
);

// Fitbit Subscriber registration challenge: GET /webhook/fitbit?verify=<token>
// returns 204 on match, 404 on mismatch, 404 when no `verify` query is present
// (Fitbit specification).
webhookApp.get("/", (c) => {
  const verify = c.req.query("verify");
  if (verify && verify === c.env.FITBIT_SUBSCRIBER_VERIFY) {
    return c.body(null, 204);
  }
  return c.body(null, 404);
});

// Fitbit Subscription notification: POST /webhook/fitbit
// Body is a JSON array of {collectionType, date, ownerId, ...}. We verify the
// HMAC-SHA1 signature, ack with 204 within Fitbit's 3-second timeout, then
// dispatch the actual fetches in the background via ctx.waitUntil.
webhookApp.post("/", async (c) => {
  const body = await c.req.text();
  const signature = c.req.header("x-fitbit-signature") ?? null;
  const ok = await verifyFitbitSignature({
    body,
    signature,
    clientSecret: c.env.FITBIT_CLIENT_SECRET,
  });
  if (!ok) return c.body(null, 401);

  let parsed: z.infer<typeof notificationSchema>;
  try {
    parsed = notificationSchema.parse(JSON.parse(body));
  } catch {
    return c.body(null, 400);
  }

  c.executionCtx.waitUntil(handleNotifications(c.env, parsed));
  return c.body(null, 204);
});

export async function handleNotifications(
  env: Env,
  notifications: ReadonlyArray<{ collectionType: string }>,
): Promise<void> {
  const collections = collectSupportedCollections(notifications);
  if (collections.size === 0) return;

  let token: string;
  try {
    token = await getAccessToken(env);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[webhook] token fetch failed: ${msg}`);
    return;
  }

  const today = todayInTimezone(env.USER_TIMEZONE);
  const yesterday = addDays(today, -1);
  const steps = [...collections].flatMap((collection) =>
    buildWebhookSteps(env, token, collection, targetDateFor(collection, today, yesterday)),
  );
  if (steps.length === 0) return;
  await runSteps("webhook", steps);
}

function collectSupportedCollections(
  notifications: ReadonlyArray<{ collectionType: string }>,
): Set<SubscriptionCollection> {
  const out = new Set<SubscriptionCollection>();
  for (const n of notifications) {
    if (
      n.collectionType === "sleep" ||
      n.collectionType === "activities" ||
      n.collectionType === "body"
    ) {
      out.add(n.collectionType);
    }
  }
  return out;
}

function targetDateFor(
  collection: SubscriptionCollection,
  today: string,
  yesterday: string,
): string {
  // Sleep logs are keyed at the bedtime date in Fitbit. The notification fires
  // after wake-up (i.e. on the morning after), so the relevant log is on
  // `yesterday` relative to the worker's USER_TIMEZONE.
  return collection === "sleep" ? yesterday : today;
}
