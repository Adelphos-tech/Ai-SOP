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

# Step 0: Disk guard — refuse to deploy below 10G free on the
# release filesystem (build + node_modules + rollback backup need it).
MIN_FREE_KB=$((10 * 1024 * 1024))
FREE_KB=$(df -kP "$(dirname "$APP_DIR")" | awk 'NR==2 {print $4}' | tr -d ' ')
if [ "${FREE_KB:-0}" -lt "$MIN_FREE_KB" ]; then
  echo "=== ERROR: only $((FREE_KB / 1024 / 1024))G free (<10G required) — deploy aborted ==="
  exit 1
fi

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
# Persistent runtime data lives OUTSIDE releases in the shared root.
# Releases get symlinks, never owned data dirs — so release pruning
# can never touch logs/uploads/backups/baselines.
#   - external symlink targets (e.g. persistent-uploads) are preserved
#   - targets inside release dirs are redirected to the shared root
#   - real release-owned dirs are migrated into shared once
SHARED_DIR="${SHARED_DIR:-/opt/sop-ai-shared}"
mkdir -p "$SHARED_DIR"
for entry in logs uploads backups baselines; do
  mkdir -p "$SHARED_DIR/$entry"
  chmod 755 "$SHARED_DIR" "$SHARED_DIR/$entry"
  [ ! -e "$STAGING_DIR/$entry" ]
  [ ! -L "$STAGING_DIR/$entry" ]
  if [ -L "$APP_DIR/$entry" ]; then
    target=$(cd -P "$APP_DIR/$entry" && pwd)
    case "$target" in
      "$APP_DIR".previous-*|"$APP_DIR".failed-*|"$APP_DIR".incoming-*)
        target="$SHARED_DIR/$entry" ;;
    esac
    ln -s "$target" "$STAGING_DIR/$entry"
  elif [ -d "$APP_DIR/$entry" ]; then
    cp -a "$APP_DIR/$entry/." "$SHARED_DIR/$entry/"
    ln -s "$SHARED_DIR/$entry" "$STAGING_DIR/$entry"
  else
    ln -s "$SHARED_DIR/$entry" "$STAGING_DIR/$entry"
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

# Step 6: Prune stale releases — ONLY after the new release is live
# and healthy. Keeps the newest KEEP_PREV rollback releases; skips any
# release dir that still owns real (non-symlink) runtime data dirs.
echo "=== Pruning stale releases ==="
KEEP_PREV=2
cd "$(dirname "$APP_DIR")"
for d in $(ls -dt "${APP_DIR}".previous-* 2>/dev/null | tail -n +$((KEEP_PREV + 1))); do
  skip=0
  for entry in logs uploads backups baselines; do
    if [ -e "$d/$entry" ] && [ ! -L "$d/$entry" ]; then
      echo "KEEP (owns real $entry data): $d"
      skip=1
    fi
  done
  [ "$skip" = 1 ] && continue
  echo "PRUNE $d"
  rm -rf "$d"
done

echo "=== CI Deploy Complete ==="
