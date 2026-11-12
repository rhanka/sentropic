#!/bin/sh
# T3 single human-executable command: stop the automation, re-read the truth,
# then roll back pre-commit or converge post-commit. Never two writers.
# Usage: t3-emergency.sh --state-dir DIR --config FILE [--finish-open] [--dry-run]
set -eu
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
STATE_DIR=""
CONFIG=""
MODE="rollback"
DRYRUN=""
while [ $# -gt 0 ]; do
  case "$1" in
    --state-dir) STATE_DIR="${2:?missing value}"; shift 2 ;;
    --config) CONFIG="${2:?missing value}"; shift 2 ;;
    --finish-open) MODE="finish-open"; shift ;;
    --dry-run) DRYRUN="--dry-run"; shift ;;
    *) echo "usage: t3-emergency.sh --state-dir DIR --config FILE [--finish-open] [--dry-run]" >&2; exit 1 ;;
  esac
done
[ -n "$STATE_DIR" ] && [ -n "$CONFIG" ] || { echo "usage: t3-emergency.sh --state-dir DIR --config FILE [--finish-open] [--dry-run]" >&2; exit 1; }
STATE_FILE="$STATE_DIR/t3-window-state.json"
if [ -f "$STATE_FILE" ]; then
  PIDS=$(node -e 'const s=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log([s.driverPid,s.childPid].filter(Boolean).join(" "))' "$STATE_FILE")
  for pid in $PIDS; do kill -TERM "$pid" 2>/dev/null || true; done
  sleep 1
  for pid in $PIDS; do kill -KILL "$pid" 2>/dev/null || true; done
fi
pkill -f "t3-watchdog.mjs --state-dir $STATE_DIR" 2>/dev/null || true
if [ "$MODE" = "finish-open" ]; then
  # shellcheck disable=SC2086
  exec node "$HERE/t3-finish-open.mjs" --config "$CONFIG" --state-dir "$STATE_DIR" $DRYRUN
fi
KUBECONFIG_FILE=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).kubeconfigFile)' "$CONFIG")
NAMESPACE=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).namespace)' "$CONFIG")
REVISIONS=$(node -e 'console.log(JSON.stringify(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).revisions ?? {}))' "$CONFIG")
# shellcheck disable=SC2086
exec node "$HERE/t3-rollback.mjs" --kubeconfig-file "$KUBECONFIG_FILE" --namespace "$NAMESPACE" --revisions-json "$REVISIONS" $DRYRUN
