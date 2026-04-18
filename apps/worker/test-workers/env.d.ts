import type { D1Migration } from "@cloudflare/vitest-pool-workers/config";
import type { Env } from "../src/types";

declare module "cloudflare:test" {
  interface ProvidedEnv extends Env {
    readonly TEST_MIGRATIONS: D1Migration[];
  }
}
