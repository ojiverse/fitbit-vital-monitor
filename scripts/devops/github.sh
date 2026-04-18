#!/usr/bin/env bash
# Idempotent GitHub repository setup via the gh CLI.
#
# Applies:
#   - repo metadata (description / homepage / topics / feature toggles)
#   - branch protection on `main` with required status check
#   - Actions policy: only github-owned + a narrow third-party allowlist
#
# Usage:   scripts/devops/github.sh
# Env:     REPO=<owner>/<repo>   (default: ojiverse/fitbit-vital-monitor)

set -euo pipefail

REPO="${REPO:-ojiverse/fitbit-vital-monitor}"
DEFAULT_BRANCH="main"
REQUIRED_CHECK="Lint · Typecheck · Build · Test"

echo "==> Target: $REPO"

command -v gh >/dev/null || { echo "gh CLI not found" >&2; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "gh is not authenticated — run 'gh auth login'" >&2; exit 1; }

# ────────────────────────────────────────────────────────────────────────────
# 1. Repo metadata
# ────────────────────────────────────────────────────────────────────────────
echo "==> Updating repo metadata ..."
gh repo edit "$REPO" \
  --description "Self-hosted Fitbit vitals wrapper, Prometheus exporter and dashboard on Cloudflare Workers + D1 + DO + R2." \
  --add-topic fitbit \
  --add-topic cloudflare-workers \
  --add-topic cloudflare-d1 \
  --add-topic cloudflare-durable-objects \
  --add-topic cloudflare-r2 \
  --add-topic prometheus-exporter \
  --add-topic svelte \
  --add-topic self-hosted \
  --enable-issues=true \
  --enable-wiki=false \
  --enable-projects=false \
  --delete-branch-on-merge=true \
  --enable-auto-merge=true \
  --enable-squash-merge=true \
  --enable-merge-commit=false \
  --enable-rebase-merge=false \
  >/dev/null

# ────────────────────────────────────────────────────────────────────────────
# 2. Branch protection on main
# ────────────────────────────────────────────────────────────────────────────
# Solo-dev friendly defaults:
#   - required status check: the verify job must be green
#   - no review count required (adjust if collaborators are added)
#   - enforce_admins=false so the owner can land emergency fixes
#   - linear history forces squash/rebase (matches "enable-squash-merge" above)
echo "==> Applying branch protection on $DEFAULT_BRANCH ..."
gh api -X PUT "repos/$REPO/branches/$DEFAULT_BRANCH/protection" --input - >/dev/null <<JSON
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["$REQUIRED_CHECK"]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": null,
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "required_linear_history": true,
  "required_conversation_resolution": false,
  "lock_branch": false,
  "block_creations": false,
  "required_signatures": false
}
JSON

# ────────────────────────────────────────────────────────────────────────────
# 3. Actions policy — allow github-owned + explicit third-party allowlist
# ────────────────────────────────────────────────────────────────────────────
echo "==> Restricting GitHub Actions to a curated allowlist ..."
gh api -X PUT "repos/$REPO/actions/permissions" --input - >/dev/null <<'JSON'
{
  "enabled": true,
  "allowed_actions": "selected"
}
JSON

gh api -X PUT "repos/$REPO/actions/permissions/selected-actions" --input - >/dev/null <<'JSON'
{
  "github_owned_allowed": true,
  "verified_allowed": false,
  "patterns_allowed": [
    "pnpm/action-setup@*",
    "flatt-security/setup-takumi-guard-npm@*",
    "cloudflare/wrangler-action@*"
  ]
}
JSON

# ────────────────────────────────────────────────────────────────────────────
# Summary
# ────────────────────────────────────────────────────────────────────────────
echo ""
echo "==> Done. Current protection state:"
gh api "repos/$REPO/branches/$DEFAULT_BRANCH/protection" \
  --jq '{
    required_status_checks: .required_status_checks.contexts,
    strict: .required_status_checks.strict,
    enforce_admins: .enforce_admins.enabled,
    allow_force_pushes: .allow_force_pushes.enabled,
    allow_deletions: .allow_deletions.enabled,
    required_linear_history: .required_linear_history.enabled
  }'
