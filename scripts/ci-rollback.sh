#!/bin/bash
# ============================================================
# CI/CD Rollback Script — called on deploy failure
# ============================================================
# Restores the previous .next build from backup.
# PM2 is restarted with the old build.
# ============================================================
set -euo pipefail

APP_DIR="/opt/sop-ai-app"
PM2_NAME="sop-app"

cd "$APP_DIR"

echo "=== CI Rollback ==="
echo "Time: $(date -u +%Y-%m-%dT%H:%M:%SZ)"

# Check if a previous build backup exists
if [ -d ".next-backup" ]; then
  echo "=== Restoring from .next-backup ==="

  # Swap: current (broken) → .next-failed, backup → .next
  if [ -d ".next" ]; then
    mv .next .next-failed-$(date +%s)
  fi
  mv .next-backup .next

  # Restart PM2 with restored build
  pm2 restart "$PM2_NAME" --update-env 2>&1 | tail -2
  sleep 3

  # Verify
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:5010/ || echo "000")
  echo "Rollback HTTP status: $STATUS"

  if [ "$STATUS" = "200" ]; then
    echo "=== Rollback SUCCESS — production restored to previous build ==="
  else
    echo "=== Rollback FAILED — manual intervention required ==="
    pm2 logs "$PM2_NAME" --lines 20 --nostream
    exit 1
  fi
else
  echo "=== No backup found — cannot rollback automatically ==="
  echo "=== Manual intervention required ==="
  exit 1
fi
