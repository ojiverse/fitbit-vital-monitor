import { fetchDevices } from "../ingest/fetchers";
import { getAccessToken } from "../token-store";
import type { Env } from "../types";
import { runSteps } from "./run-steps";

export async function runHourly(env: Env): Promise<void> {
  const token = await getAccessToken(env);

  await runSteps("hourly", [{ name: "devices", run: () => fetchDevices(env, token) }]);
}
