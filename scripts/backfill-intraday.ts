#!/usr/bin/env node
// Backfill intraday samples for a single day by re-fetching the Fitbit
// 1-minute window and replaying it through `INSERT OR IGNORE`. Use this when
// the high-frequency cron missed a window (e.g. CPU-limit incident, deploy
// outage) and the gap is still inside Fitbit's 7-day intraday retention.
//
// Heart rate is the only intraday metric the worker currently ingests, so the
// script is hard-wired to that endpoint; extend `ENDPOINTS` to add others.

import { type SpawnSyncReturns, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const WORKER_DIR = resolve(new URL(".", import.meta.url).pathname, "../apps/worker");
const D1_BINDING = "fitbit_vital_monitor";

type Metric = "heart_rate";
type EndpointSpec = {
  readonly path: (date: string) => string;
  readonly extract: (json: unknown) => ReadonlyArray<{ time: string; value: number }>;
};
const ENDPOINTS: Readonly<Record<Metric, EndpointSpec>> = {
  heart_rate: {
    path: (date) => `/1/user/-/activities/heart/date/${date}/1d/1min.json`,
    extract: (json) => {
      const root = json as {
        "activities-heart-intraday"?: { dataset?: ReadonlyArray<{ time: string; value: number }> };
      };
      return root["activities-heart-intraday"]?.dataset ?? [];
    },
  },
};

type Args = {
  readonly date: string;
  readonly metric: Metric;
  readonly fromLocal: string;
  readonly toLocal: string;
  readonly tz: string;
  readonly apply: boolean;
};

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const accessToken = readAccessToken();
  const samples = fetchSamples(args, accessToken);
  const filtered = samples.filter((s) => s.time >= args.fromLocal && s.time <= args.toLocal);
  console.error(
    `[backfill] ${args.metric} ${args.date} (${args.tz}): Fitbit returned ${samples.length} minutes; ${filtered.length} fall within [${args.fromLocal}, ${args.toLocal}]`,
  );
  if (filtered.length > 0) {
    console.error(`[backfill]   first=${JSON.stringify(filtered[0])}`);
    console.error(`[backfill]   last =${JSON.stringify(filtered[filtered.length - 1])}`);
  }
  if (filtered.length === 0) {
    console.error("[backfill] nothing to insert; exiting");
    return;
  }
  const sql = buildSql(args, filtered);
  if (!args.apply) {
    process.stdout.write(sql);
    console.error("\n[backfill] dry-run (stdout). Pass --apply to write to D1.");
    return;
  }
  const tmpDir = mkdtempSync(join(tmpdir(), "fb-backfill-"));
  const sqlPath = join(tmpDir, "backfill.sql");
  writeFileSync(sqlPath, sql, "utf8");
  console.error(`[backfill] applying via wrangler d1 execute --file=${sqlPath}`);
  const res = runWrangler(["d1", "execute", D1_BINDING, "--remote", `--file=${sqlPath}`], {
    inheritStdio: true,
  });
  if (res.status !== 0) {
    throw new Error(`wrangler d1 execute failed (exit ${res.status})`);
  }
}

function parseArgs(argv: ReadonlyArray<string>): Args {
  const opts = new Map<string, string>();
  const flags = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? "";
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      flags.add(key);
    } else {
      opts.set(key, next);
      i++;
    }
  }
  const date = opts.get("date");
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    fail("--date YYYY-MM-DD is required (the local date in --tz)");
  }
  const metric = (opts.get("metric") ?? "heart_rate") as Metric;
  if (!(metric in ENDPOINTS)) {
    fail(`unsupported --metric ${metric} (supported: ${Object.keys(ENDPOINTS).join(", ")})`);
  }
  const fromLocal = normalizeTime(opts.get("from") ?? "00:00:00");
  const toLocal = normalizeTime(opts.get("to") ?? "23:59:59");
  return {
    date,
    metric,
    fromLocal,
    toLocal,
    tz: opts.get("tz") ?? "Asia/Tokyo",
    apply: flags.has("apply"),
  };
}

function normalizeTime(raw: string): string {
  const m = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(raw);
  if (!m) fail(`invalid time ${raw}; expected HH:MM or HH:MM:SS`);
  return `${m[1]}:${m[2]}:${m[3] ?? "00"}`;
}

function readAccessToken(): string {
  const res = runWrangler(
    [
      "d1",
      "execute",
      D1_BINDING,
      "--remote",
      "--json",
      "--command",
      "SELECT access_token, expires_at FROM auth_tokens LIMIT 1;",
    ],
    { inheritStdio: false },
  );
  if (res.status !== 0) {
    throw new Error(`wrangler d1 execute (token read) failed: ${res.stderr.toString()}`);
  }
  const parsed = JSON.parse(res.stdout.toString()) as Array<{
    results?: Array<{ access_token: string; expires_at: string }>;
  }>;
  const row = parsed[0]?.results?.[0];
  if (!row) throw new Error("no row in auth_tokens");
  const remainingMs = Date.parse(row.expires_at) - Date.now();
  if (remainingMs < 60_000) {
    throw new Error(
      `access_token expires in ${Math.round(remainingMs / 1000)}s; wait for the next /15min cron to rotate it then re-run`,
    );
  }
  return row.access_token;
}

function fetchSamples(args: Args, token: string): ReadonlyArray<{ time: string; value: number }> {
  const url = `https://api.fitbit.com${ENDPOINTS[args.metric].path(args.date)}`;
  const result = spawnSync(
    "curl",
    ["-sS", "-H", `Authorization: Bearer ${token}`, "--max-time", "20", url],
    { encoding: "buffer" },
  );
  if (result.status !== 0) {
    throw new Error(`curl failed (${result.status}): ${result.stderr.toString()}`);
  }
  const text = result.stdout.toString("utf8");
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Fitbit response was not JSON: ${text.slice(0, 200)}`);
  }
  if (typeof json === "object" && json !== null && "errors" in json) {
    throw new Error(`Fitbit API error: ${JSON.stringify(json)}`);
  }
  return ENDPOINTS[args.metric].extract(json);
}

function buildSql(args: Args, samples: ReadonlyArray<{ time: string; value: number }>): string {
  const rows = samples.map((s) => {
    const utc = localTimeToUtcIso(args.date, s.time, args.tz);
    return `('${utc}','${args.metric}',${s.value})`;
  });
  return `INSERT OR IGNORE INTO vitals (timestamp, metric_type, value) VALUES\n${rows.join(",\n")};\n`;
}

// Convert a wall-clock (date, HH:MM:SS) in `tz` to a UTC ISO string. Mirrors
// apps/worker/src/util/time.ts:localToUtcIso so backfilled rows line up byte
// for byte with what the cron writes.
function localTimeToUtcIso(date: string, time: string, tz: string): string {
  const baselineMs = Date.parse(`${date}T${time}Z`);
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const map = new Map<string, string>();
  for (const p of fmt.formatToParts(new Date(baselineMs))) map.set(p.type, p.value);
  const hour = map.get("hour") === "24" ? "00" : (map.get("hour") ?? "00");
  const wallInTzAsUtcMs = Date.UTC(
    Number(map.get("year") ?? 1970),
    Number(map.get("month") ?? 1) - 1,
    Number(map.get("day") ?? 1),
    Number(hour),
    Number(map.get("minute") ?? 0),
    Number(map.get("second") ?? 0),
  );
  const offsetMs = wallInTzAsUtcMs - baselineMs;
  return new Date(baselineMs - offsetMs).toISOString().replace(/\.\d{3}Z$/, ".000Z");
}

function runWrangler(
  args: ReadonlyArray<string>,
  opts: { readonly inheritStdio: boolean },
): SpawnSyncReturns<Buffer> {
  return spawnSync("pnpm", ["exec", "wrangler", ...args], {
    cwd: WORKER_DIR,
    stdio: opts.inheritStdio ? "inherit" : ["ignore", "pipe", "pipe"],
  });
}

function fail(msg: string): never {
  console.error(`[backfill] ${msg}`);
  console.error(
    "\nUsage: pnpm backfill:intraday -- --date YYYY-MM-DD [--from HH:MM] [--to HH:MM] [--metric heart_rate] [--tz Asia/Tokyo] [--apply]",
  );
  process.exit(1);
}

try {
  main();
} catch (e) {
  console.error(`[backfill] ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}
