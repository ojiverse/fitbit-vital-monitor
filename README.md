# fitbit-vital-monitor

[![CI/CD](https://github.com/ojiverse/fitbit-vital-monitor/actions/workflows/ci-cd.yml/badge.svg)](https://github.com/ojiverse/fitbit-vital-monitor/actions/workflows/ci-cd.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Runs on Cloudflare](https://img.shields.io/badge/runs%20on-Cloudflare%20Workers-f38020.svg)](https://workers.cloudflare.com/)

A **single-tenant, self-hosted** Fitbit vitals wrapper, Prometheus exporter and dashboard. One
`wrangler deploy` gives you a dashboard, a `/metrics` scrape endpoint, and a JSON API — all
running inside the Cloudflare free tier (Workers + D1 + Durable Objects + R2).

## Features

- **Four cron jobs** that pull from the Fitbit Web API on tuned schedules
  (15 min / 1 h / daily post-wake / 4 h) and fit within ~16 req/h, leaving 90 % of the quota free.
- **Durable Object**-serialised OAuth refresh so concurrent cron invocations can never burn a
  one-shot `refresh_token`.
- **Prometheus `/metrics`** with freshness, rate-limit, and token-expiry gauges for true
  observability (see [`docs/metrics.md`](./docs/metrics.md)).
- **Svelte 5 + uPlot** dashboard served from the same Worker as static assets — Dashboard view
  with latest cards, History view with selectable metric / date range / intraday day.
- **R2 long-term archive** for intraday data beyond the 7-day retention window (zero egress cost).
- **97 tests**: 93 Node unit tests on an in-memory fake D1/R2, plus 4 `@cloudflare/vitest-pool-workers`
  smoke tests running in a real miniflare runtime.
- **GitHub Actions CI/CD** that lints, type-checks, tests, builds, applies D1 migrations and
  deploys on every push to `main`.

## Architecture at a glance

```
Fitbit Web API ─── OAuth 2.0 (PKCE) ───┐
                                       ▼
   ┌─────────── Cloudflare Worker ───────────┐   HTTPS
   │  Cron (×4) ─► TokenStore (DO) ─► Fitbit │◄──────── Prometheus / Grafana (/metrics)
   │      │                                  │
   │      └─► D1 (vitals / daily / tokens)   │◄──────── Svelte GUI (/, /#history)
   │                         │                │
   │                         └─► R2 archive   │◄──────── Any HTTP client (/api/vitals/*)
   └──────────────────────────────────────────┘
```

See [`docs/DESIGN.md`](./docs/DESIGN.md) for the full design,
[`docs/architecture.md`](./docs/architecture.md) for the infra breakdown,
[`docs/fitbit-api.md`](./docs/fitbit-api.md) for the Fitbit API cheat-sheet,
and [`docs/metrics.md`](./docs/metrics.md) for the Prometheus metrics catalog.

## Prerequisites

- **Node.js >= 20** and **pnpm** (this repo pins `pnpm@9.12.0`)
- **Cloudflare** account with Workers + D1 + R2 enabled (free tier is sufficient)
- **Fitbit Developer** account with a **Personal** application:
  - OAuth 2.0 Application Type: `Personal` *(required — gives automatic Intraday API access)*
  - Callback URL: `http://localhost:48125/callback`

## Getting started

### 1. Provision Cloudflare resources

```sh
pnpm install
pnpm --filter @fitbit-vital-monitor/worker d1:create
pnpm --filter @fitbit-vital-monitor/worker r2:create
```

Copy the printed **D1 `database_id`** into `apps/worker/wrangler.toml` under `[[d1_databases]]`.

### 2. Run the OAuth bootstrap

```sh
FITBIT_CLIENT_ID=xxxxxx FITBIT_CLIENT_SECRET=yyyyyy pnpm bootstrap
```

The CLI spins up a loopback HTTP server on port 48125, opens the Fitbit consent screen in your
browser, completes the Authorization Code + PKCE flow, and prints the exact
`wrangler secret put` commands you need next.

### 3. Store the secrets and apply migrations

```sh
cd apps/worker
echo "<refresh_token from bootstrap>" | pnpm exec wrangler secret put FITBIT_REFRESH_TOKEN_SEED
echo "<client_id>"                    | pnpm exec wrangler secret put FITBIT_CLIENT_ID
pnpm exec wrangler secret put FITBIT_CLIENT_SECRET     # paste at the prompt
cd ../..
pnpm --filter @fitbit-vital-monitor/worker d1:migrate:remote
```

### 4. Deploy

```sh
pnpm deploy:worker   # builds the GUI then runs `wrangler deploy`
```

> `pnpm deploy` is a pnpm built-in — use `deploy:worker` or `pnpm run deploy:worker`.

The first cron tick (within 15 minutes) populates the dashboard and exposes `/metrics`.

## Usage

After deployment the Worker URL (`https://<name>.workers.dev`) serves:

| Path | What |
| :-- | :-- |
| `/` | Svelte dashboard (latest cards + devices) |
| `/#history` | Metric history with daily / intraday toggle |
| `/api/vitals/latest` | Latest intraday + daily values + devices (JSON) |
| `/api/vitals/daily?metric=…&from=YYYY-MM-DD&to=YYYY-MM-DD` | Daily series |
| `/api/vitals/intraday?metric=…&date=YYYY-MM-DD` | Intraday samples for a given day (7-day retention) |
| `/metrics` | Prometheus exposition (see `docs/metrics.md`) |
| `/healthz` | Liveness probe |

Point Prometheus at `/metrics` with a 30–60 s scrape interval — scrape frequency and Fitbit
pull frequency are independent.

### Re-bootstrapping

If the `auth_tokens` row is lost, Fitbit revokes consent, or the Worker is idle long enough for
the `refresh_token` to expire: re-run `pnpm bootstrap`, overwrite `FITBIT_REFRESH_TOKEN_SEED`,
then delete the `auth_tokens` row so the Worker falls back to the new seed on the next cron
tick.

```sh
pnpm exec wrangler d1 execute fitbit_vital_monitor --remote --command="DELETE FROM auth_tokens"
```

## Development

### Local dev server

Two terminals — Vite proxies `/api/*` and `/metrics` to `wrangler dev`:

```sh
# Terminal 1: Worker on :8787
cp apps/worker/.dev.vars.example apps/worker/.dev.vars
# fill in FITBIT_CLIENT_ID / FITBIT_CLIENT_SECRET / FITBIT_REFRESH_TOKEN_SEED
pnpm --filter @fitbit-vital-monitor/worker d1:migrate:local
pnpm dev:worker

# Terminal 2: Svelte GUI on :5173 with HMR
pnpm dev:gui
```

Crons don't fire automatically in `wrangler dev`; trigger them manually:

```sh
curl "http://localhost:8787/__scheduled?cron=*/15+*+*+*+*"   # High frequency
curl "http://localhost:8787/__scheduled?cron=0+*+*+*+*"      # Hourly
curl "http://localhost:8787/__scheduled?cron=0+23+*+*+*"     # Post-wake (08:00 JST)
curl "http://localhost:8787/__scheduled?cron=0+*/4+*+*+*"    # Body + R2 archive
```

### Checks

```sh
pnpm lint        # biome
pnpm typecheck   # tsc on worker + scripts + svelte-check on gui
pnpm test        # 93 unit tests + 4 pool-workers smoke tests
```

The worker package has two test suites:

- `test:unit` — Node tests backed by an in-memory fake D1 (better-sqlite3) and fake R2.
- `test:workers` — real Workers runtime via `@cloudflare/vitest-pool-workers` (miniflare).

### CI/CD

[`.github/workflows/ci-cd.yml`](./.github/workflows/ci-cd.yml) runs every push and PR, and
additionally applies D1 migrations + `wrangler deploy`s on pushes to `main`.

Required GitHub repository secrets:

| Secret | How to obtain |
| :-- | :-- |
| `CLOUDFLARE_API_TOKEN` | [dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens) → **Create Token** → use "Edit Cloudflare Workers" template, then add **D1 : Edit** and **R2 : Edit** on the same account. |
| `CLOUDFLARE_ACCOUNT_ID` | Shown in the Cloudflare dashboard sidebar or via `wrangler whoami`. |

Fitbit secrets (`FITBIT_CLIENT_ID` / `FITBIT_CLIENT_SECRET` / `FITBIT_REFRESH_TOKEN_SEED`) are
**not** managed by CI — they live as Worker Secrets and are untouched by `wrangler deploy`.

## Troubleshooting

**Fitbit returns `403 PERMISSION_DENIED` on intraday endpoints.** Your app is not registered
as `Personal`. Open [dev.fitbit.com/apps](https://dev.fitbit.com/apps) → your app → set
**OAuth 2.0 Application Type** to `Personal` and save. Existing tokens keep working after the
change.

**`No migrations to apply!` on first `d1:migrate:remote`.** The migration ran successfully —
wrangler prints this when the `d1_migrations` metadata table already records the file. Verify
with `pnpm exec wrangler d1 execute fitbit_vital_monitor --remote --command="SELECT name FROM sqlite_master WHERE type='table'"`.

**Dashboard shows empty `intraday` but `daily` is populated.** The Fitbit cloud hasn't received
any new 1-minute samples since the last watch sync — this is normal and resolves at the next
watch↔phone↔cloud sync (~15 min cadence).

**Nothing happens after deploy.** Cron triggers fire on their own schedule — `*/15` at the next
`:00 / :15 / :30 / :45`. Check `pnpm --filter @fitbit-vital-monitor/worker exec wrangler tail`
for live logs.

## License

MIT. See [`LICENSE`](./LICENSE).
