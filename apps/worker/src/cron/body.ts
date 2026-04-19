import type { Env } from "../types";
import { runArchive } from "./archive";
import { runSteps } from "./run-steps";

// Weight ingestion moved to the `body` Subscription webhook (DESIGN.md §4.4),
// so this cron only carries the archive sweep that purges intraday data older
// than the 7-day retention window.
export async function runBody(env: Env): Promise<void> {
  await runSteps("body", [{ name: "archive", run: () => runArchive(env) }]);
}
