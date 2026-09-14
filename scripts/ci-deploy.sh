#!/bin/bash
# ============================================================
# CI/CD Deploy Script — called by GitHub Actions
# ============================================================
# This script runs ON the production server after rsync.
# It installs deps, restarts PM2, and verifies health.
#
# Unlike phase-37-safe-deploy.sh, this does NOT rebuild
# on the server — the build is done in CI and rsynced.
# ============================================================
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/sop-ai-app}"
PM2_NAME="${PM2_NAME:-sop-app}"
BUILD_ID="${NEXT_PUBLIC_BUILD_ID:-ci-unknown}"
source "$(dirname "${BASH_SOURCE[0]}")/ci-rollback.sh"
validate_release
STAGING_DIR="${APP_DIR}.incoming-${RELEASE_ID}"
exec 9>"${APP_DIR}.deploy.lock"
flock -n 9
[ -d "$APP_DIR" ]
[ ! -L "$APP_DIR" ]
[ -d "$STAGING_DIR" ]
[ ! -L "$STAGING_DIR" ]
[ ! -e "$PREVIOUS_DIR" ]
[ ! -L "$PREVIOUS_DIR" ]
[ ! -e "$FAILED_DIR" ]
[ ! -L "$FAILED_DIR" ]
cd "$STAGING_DIR"

rollback_on_exit() {
  local status=$?
  trap - EXIT INT TERM
  if [ "$status" -ne 0 ] && [ -d "$PREVIOUS_DIR" ]; then
    rollback_release || echo "ERROR: Automatic rollback failed; manual intervention required." >&2
  fi
  exit "$status"
}
trap rollback_on_exit EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

echo "=== CI Deploy ==="
echo "Time: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "Build ID: $BUILD_ID"

# Step 1: Install dependencies (if package-lock changed)
echo "=== Installing dependencies ==="
npm ci --include=dev --no-audit --no-fund

# Step 2: Verify build exists
if [ ! -s ".next/BUILD_ID" ] || [ ! -f ".next/prerender-manifest.json" ]; then
  echo "=== ERROR: No build found in .next/ ==="
  exit 1
fi

[ -d node_modules ]
[ -f package.json ]
[ -f package-lock.json ]
[ -f next.config.js ]
echo "=== Build verified (BUILD_ID: $(cat .next/BUILD_ID)) ==="
printf '%s\n' "$RELEASE_ID" > .ci-release-id

shopt -s nullglob
for env_file in "$APP_DIR"/.env "$APP_DIR"/.env.*; do
  [ -f "$env_file" ] || continue
  [ "$(basename "$env_file")" = .env.example ] && continue
  cp -p "$env_file" "$STAGING_DIR/"
done
for entry in logs uploads backups baselines; do
  if [ -d "$APP_DIR/$entry" ]; then
    [ ! -e "$STAGING_DIR/$entry" ]
    [ ! -L "$STAGING_DIR/$entry" ]
    if [ -L "$APP_DIR/$entry" ]; then
      ln -s "$(cd -P "$APP_DIR/$entry" && pwd)" "$STAGING_DIR/$entry"
    else
      ln -s "$PREVIOUS_DIR/$entry" "$STAGING_DIR/$entry"
    fi
  fi
done

# Step 2b: Backup current build for rollback
echo "=== Backing up current build ==="
cd "$(dirname "$APP_DIR")"
mv "$APP_DIR" "$PREVIOUS_DIR"
mv "$STAGING_DIR" "$APP_DIR"

# Step 3: Restart PM2
echo "=== Restarting PM2 ==="
pm2 restart "$PM2_NAME" --update-env

# Step 4: Wait for startup
sleep 3

# Step 5: Local health check
echo "=== Local health check ==="
if ! check_release_health; then
  echo "=== ERROR: Local health check failed ==="
  exit 1
fi
echo "Local HTTP status: 200"

echo "=== CI Deploy Complete ==="
