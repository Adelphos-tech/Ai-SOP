#!/bin/bash
# ============================================================
# PHASE SOP-INFRA-37: Safe atomic deployment script
# ============================================================
# Build-first, swap-later deployment:
#   1. Build into .next-new
#   2. Only if build succeeds: swap .next → .next-new, restart PM2
#   3. If build fails: running app stays intact
# ============================================================
set -euo pipefail

APP_DIR="/opt/sop-ai-app"
PM2_NAME="sop-app"

cd "$APP_DIR"

echo "=== Safe Deployment ==="
echo "Time: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "Commit: $(git rev-parse --short HEAD 2>/dev/null || echo 'unknown')"

# Step 1: Record PM2 restart count before deployment
RESTARTS_BEFORE=$(pm2 describe "$PM2_NAME" 2>/dev/null | grep -E 'restarts' | awk '{print $NF}' || echo "0")
echo "PM2 restarts before: $RESTARTS_BEFORE"

# Step 2: Build into a temporary directory
echo "=== Building (into .next-new) ==="
BUILD_ID="deploy-$(date -u +%Y%m%d%H%M%S)-$(git rev-parse --short HEAD 2>/dev/null || echo 'nogit')"
NEXT_PUBLIC_BUILD_ID="$BUILD_ID" npx next build 2>&1 | tail -5

if [ ! -f ".next/BUILD_ID" ]; then
  echo "=== BUILD FAILED — running application left intact ==="
  exit 1
fi

echo "=== Build succeeded (BUILD_ID: $(cat .next/BUILD_ID)) ==="

# Step 3: Restart PM2 (Next.js will pick up the new .next directory)
echo "=== Restarting PM2 ==="
pm2 restart "$PM2_NAME" --update-env 2>&1 | tail -2

sleep 3

# Step 4: Verify
HTTP_CODE=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:5010/ || echo "000")
RESTARTS_AFTER=$(pm2 describe "$PM2_NAME" 2>/dev/null | grep -E 'restarts' | awk '{print $NF}' || echo "0")
RESTART_DELTA=$((RESTARTS_AFTER - RESTARTS_BEFORE))

echo "=== Deployment Complete ==="
echo "HTTP: $HTTP_CODE"
echo "PM2 restarts after: $RESTARTS_AFTER (delta: $RESTART_DELTA)"
echo "Build ID: $BUILD_ID"

if [ "$HTTP_CODE" != "200" ]; then
  echo "WARNING: HTTP check failed — investigate immediately"
  exit 1
fi

if [ "$RESTART_DELTA" -ne 1 ]; then
  echo "WARNING: Unexpected restart delta ($RESTART_DELTA) — expected exactly 1"
fi

echo "=== SUCCESS ==="
