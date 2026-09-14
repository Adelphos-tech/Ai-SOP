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

APP_DIR="/opt/sop-ai-app"
PM2_NAME="sop-app"
BUILD_ID="${NEXT_PUBLIC_BUILD_ID:-ci-unknown}"

cd "$APP_DIR"

echo "=== CI Deploy ==="
echo "Time: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "Build ID: $BUILD_ID"

# Step 1: Install dependencies (if package-lock changed)
echo "=== Installing dependencies ==="
npm ci --production=false 2>&1 | tail -3

# Step 2: Verify build exists
if [ ! -f ".next/BUILD_ID" ]; then
  echo "=== ERROR: No build found in .next/ ==="
  exit 1
fi

echo "=== Build verified (BUILD_ID: $(cat .next/BUILD_ID)) ==="

# Step 2b: Backup current build for rollback
if [ -d ".next" ]; then
  echo "=== Backing up current build ==="
  rm -rf .next-backup
  cp -a .next .next-backup
fi

# Step 3: Restart PM2
echo "=== Restarting PM2 ==="
pm2 restart "$PM2_NAME" --update-env 2>&1 | tail -2

# Step 4: Wait for startup
sleep 3

# Step 5: Local health check
echo "=== Local health check ==="
LOCAL_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:5010/ || echo "000")
echo "Local HTTP status: $LOCAL_STATUS"

if [ "$LOCAL_STATUS" != "200" ]; then
  echo "=== ERROR: Local health check failed ==="
  pm2 logs "$PM2_NAME" --lines 20 --nostream
  exit 1
fi

echo "=== CI Deploy Complete ==="
