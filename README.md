# fitbit-vital-monitor

Self-hosted Fitbit vitals wrapper, Prometheus exporter and dashboard running entirely on the
Cloudflare free tier (Workers + D1 + Durable Objects + R2). One deployment = one Fitbit user.

See [`docs/DESIGN.md`](./docs/DESIGN.md) for the full design, [`docs/architecture.md`](./docs/architecture.md)
for the infra breakdown, [`docs/fitbit-api.md`](./docs/fitbit-api.md) for the API cheat-sheet,
and [`docs/metrics.md`](./docs/metrics.md) for the Prometheus metrics catalog.

## Prerequisites

- Node.js >= 20 and pnpm
- Cloudflare account with Workers + D1 access (free tier is enough)
- Fitbit Developer account with a **Personal** application registered
  - OAuth 2.0 Application Type: `Personal`
  - Callback URL: `http://localhost:48125/callback`

## Layout

```
apps/worker/    Cloudflare Worker (Cron + HTTP + Durable Object + R2)
apps/gui/       Svelte 5 dashboard (served from the same Worker as Static Assets)
scripts/        Local OAuth bootstrap CLI
migrations/     D1 schema migrations
docs/           Design and reference documentation
```

## One-time setup

```sh
pnpm install

# Create D1 database — copy the printed database_id into apps/worker/wrangler.toml
pnpm --filter @fitbit-vital-monitor/worker d1:create

# Create R2 bucket
pnpm --filter @fitbit-vital-monitor/worker r2:create

# Run the local OAuth flow (opens your browser). Prints refresh_token + secret commands.
FITBIT_CLIENT_ID=... FITBIT_CLIENT_SECRET=... pnpm bootstrap

# Store the three secrets
wrangler secret put FITBIT_CLIENT_ID --config apps/worker/wrangler.toml
wrangler secret put FITBIT_CLIENT_SECRET --config apps/worker/wrangler.toml
wrangler secret put FITBIT_REFRESH_TOKEN_SEED --config apps/worker/wrangler.toml

# Apply migrations to the remote D1
pnpm --filter @fitbit-vital-monitor/worker d1:migrate:remote
```

## Deploy

```sh
pnpm deploy:worker   # Builds the GUI, then `wrangler deploy` on the Worker
```

(`pnpm deploy` is a pnpm built-in — use `deploy:worker` or `pnpm run deploy:worker`.)

After deploy, your Worker URL (`https://<name>.workers.dev`) serves:

| Path | What |
| :-- | :-- |
| `/` | Svelte dashboard |
| `/#history` | History view |
| `/api/vitals/latest` | Latest values (JSON) |
| `/api/vitals/daily?metric=...&from=...&to=...` | Daily series |
| `/api/vitals/intraday?metric=...&date=...` | Intraday samples for a given day |
| `/metrics` | Prometheus exposition |
| `/healthz` | Liveness probe |

## Local development

Two terminals — Vite dev server proxies API calls to `wrangler dev`:

```sh
# Terminal 1 — Worker on :8787
# (first time only: create a local D1, apply migrations, populate .dev.vars)
cp apps/worker/.dev.vars.example apps/worker/.dev.vars
# fill in FITBIT_CLIENT_ID / FITBIT_CLIENT_SECRET / FITBIT_REFRESH_TOKEN_SEED
pnpm --filter @fitbit-vital-monitor/worker d1:migrate:local
pnpm dev:worker

# Terminal 2 — GUI on :5173 with HMR
pnpm dev:gui
```

Cron jobs do not fire automatically in `wrangler dev`. Trigger manually:

```sh
curl "http://localhost:8787/__scheduled?cron=*/15+*+*+*+*"   # High frequency
curl "http://localhost:8787/__scheduled?cron=0+*+*+*+*"      # Hourly
curl "http://localhost:8787/__scheduled?cron=0+23+*+*+*"     # Post-wake (8:00 JST)
curl "http://localhost:8787/__scheduled?cron=0+*/4+*+*+*"    # Body + archive
```

## Re-bootstrap

If the D1 `auth_tokens` row is lost or Fitbit revokes consent, re-run `pnpm bootstrap`,
overwrite `FITBIT_REFRESH_TOKEN_SEED`, then delete the `auth_tokens` row so the Worker falls
back to the seed on the next cron tick.

## Tests

```sh
pnpm test             # all workspaces
pnpm lint
pnpm typecheck
```

The worker package has two test suites:
- `test:unit` — Node tests backed by in-memory fake D1/R2 (~100ms)
- `test:workers` — real Workers runtime via `@cloudflare/vitest-pool-workers` (miniflare)

## CI/CD

`.github/workflows/ci-cd.yml` runs `lint → typecheck → test → build:gui` on every push and PR,
and additionally applies D1 migrations and `wrangler deploy`s to Cloudflare on pushes to `main`.

### Required GitHub repository secrets

| Secret | How to obtain |
| :-- | :-- |
| `CLOUDFLARE_API_TOKEN` | [dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens) → **Create Token** → use "Edit Cloudflare Workers" template, then add **D1 : Edit** and **R2 : Edit** on the same account. |
| `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare account ID (shown in the dashboard sidebar or in `wrangler whoami`). |

Fitbit secrets (`FITBIT_CLIENT_ID` / `FITBIT_CLIENT_SECRET` / `FITBIT_REFRESH_TOKEN_SEED`) are
**not** managed by CI — they live as Worker Secrets and are untouched by `wrangler deploy`.

## License

MIT.
