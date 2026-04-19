#!/usr/bin/env node
// Register Fitbit Subscription endpoints against the deployed worker. Run
// once per Fitbit Subscriber after deployment. Idempotent: re-running a
// subscription with the same id is a no-op on Fitbit's side.

const COLLECTIONS = ["sleep", "activities", "body"] as const;

type Collection = (typeof COLLECTIONS)[number];

async function main(): Promise<void> {
  const accessToken = process.env.FITBIT_ACCESS_TOKEN;
  const subscriberId = process.env.FITBIT_SUBSCRIBER_ID;
  if (!accessToken || !subscriberId) {
    console.error(
      "Missing env vars. Required: FITBIT_ACCESS_TOKEN (a current OAuth access token, e.g. printed by `pnpm bootstrap`), FITBIT_SUBSCRIBER_ID (the Subscriber numeric id from the Fitbit Developer portal).",
    );
    process.exit(1);
  }

  for (const collection of COLLECTIONS) {
    const subscriptionId = `${collection}-1`;
    await registerSubscription({ accessToken, subscriberId, collection, subscriptionId });
    console.log(`registered ${collection} subscription (id=${subscriptionId})`);
  }
  console.log(
    "\nAll subscriptions registered. Fitbit will now POST to your worker /webhook/fitbit endpoint.",
  );
}

async function registerSubscription(args: {
  accessToken: string;
  subscriberId: string;
  collection: Collection;
  subscriptionId: string;
}): Promise<void> {
  const url = `https://api.fitbit.com/1/user/-/${args.collection}/apiSubscriptions/${args.subscriptionId}.json`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${args.accessToken}`,
      "X-Fitbit-Subscriber-Id": args.subscriberId,
      "Content-Length": "0",
    },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `Subscription registration failed for ${args.collection} (${response.status}): ${text}`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
