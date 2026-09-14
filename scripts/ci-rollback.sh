#!/bin/bash
# ============================================================
# CI/CD Rollback Script — called on deploy failure
# ============================================================
# Restores the previous .next build from backup.
# PM2 is restarted with the old build.
# ============================================================
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/sop-ai-app}"
PM2_NAME="${PM2_NAME:-sop-app}"
LOCAL_HEALTH_URL="${LOCAL_HEALTH_URL:-http://127.0.0.1:5010}"

validate_release() {
  [[ "${RELEASE_ID:-}" =~ ^[a-zA-Z0-9][a-zA-Z0-9-]{0,100}$ ]] || return 1
  [[ "$APP_DIR" = /* && "$APP_DIR" != / && "$APP_DIR" != */ ]] || return 1
  PREVIOUS_DIR="${APP_DIR}.previous-${RELEASE_ID}"
  FAILED_DIR="${APP_DIR}.failed-${RELEASE_ID}"
}

check_release_health() {
  local build_id
  build_id=$(cat "$APP_DIR/.next/BUILD_ID")
  [[ "$build_id" =~ ^[a-zA-Z0-9_-]+$ ]] || return 1
  for attempt in 1 2 3 4 5; do
    if curl --fail --silent --show-error --max-time 10 -o /dev/null "$LOCAL_HEALTH_URL/students" &&
       curl --fail --silent --show-error --max-time 10 -o /dev/null "$LOCAL_HEALTH_URL/_next/static/$build_id/_buildManifest.js"; then
      return 0
    fi
    sleep 2
  done
  return 1
}

rollback_release() {
  validate_release || return 1
  cd "$(dirname "$APP_DIR")" || return 1

  echo "=== CI Rollback ==="
  echo "Time: $(date -u +%Y-%m-%dT%H:%M:%SZ)"

  # Check if a previous build backup exists
  if [ -d "$PREVIOUS_DIR" ] && [ -f "$PREVIOUS_DIR/.next/BUILD_ID" ]; then
    echo "=== Restoring previous release: $PREVIOUS_DIR ==="

    # Swap: current (broken) → .next-failed, backup → .next
    if [ -e "$APP_DIR" ]; then
      [ -f "$APP_DIR/.ci-release-id" ] && [ "$(cat "$APP_DIR/.ci-release-id")" = "$RELEASE_ID" ] || return 1
      [ ! -e "$FAILED_DIR" ] && [ ! -L "$FAILED_DIR" ] || return 1
      mv "$APP_DIR" "$FAILED_DIR" || return 1
    fi
    mv "$PREVIOUS_DIR" "$APP_DIR" || return 1

    # Restart PM2 with restored build
    pm2 restart "$PM2_NAME" --update-env || return 1
    sleep 3

    # Verify
    if check_release_health; then
      echo "Rollback HTTP status: 200"
      echo "=== Rollback SUCCESS — production restored to previous build ==="
    else
      echo "=== Rollback FAILED — manual intervention required ==="
      return 1
    fi
  else
    echo "=== No backup found — cannot rollback automatically ==="
    echo "=== Manual intervention required ==="
    return 1
  fi
}

if [[ "${BASH_SOURCE[0]}" = "$0" ]]; then
  validate_release
  exec 9>"${APP_DIR}.deploy.lock"
  flock -n 9
  rollback_release
fi
