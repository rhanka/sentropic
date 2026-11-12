#!/bin/sh
# T3 single human-executable command: stop the automation, take the
# single-writer lock, freeze the writer, re-read the truth (classify), then
# roll back pre-commit or converge post-commit. Never two writers, never a
# legacy boot on a committed database.
# Usage: t3-emergency.sh --state-dir DIR --config FILE [--finish-open] [--dry-run]
set -eu
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
STATE_DIR=""
CONFIG=""
MODE="auto"
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

# 1. Stop the automation: driver pids from the state file, then the watchdog.
# Kills the whole process group plus direct children (SIGTERM then SIGKILL)
# and grandchildren (kubectl spawned by execution/ops/run), so no orphan
# keeps mutating the cluster during the emergency recovery.
killtree() {
  _pid="$1"; _sig="$2"
  if [ "$_sig" = "TERM" ]; then
    kill -TERM -"$_pid" 2>/dev/null || true
    pkill -TERM -P "$_pid" 2>/dev/null || true
  else
    kill -KILL -"$_pid" 2>/dev/null || true
    pkill -KILL -P "$_pid" 2>/dev/null || true
  fi
  for _c in $(ps -o pid --ppid "$_pid" 2>/dev/null | tail -n +2); do
    pkill -KILL -P "$_c" 2>/dev/null || true
    kill -KILL "$_c" 2>/dev/null || true
  done
  if [ "$_sig" = "TERM" ]; then kill -TERM "$_pid" 2>/dev/null || true;
  else kill -KILL "$_pid" 2>/dev/null || true; fi
}
STATE_FILE="$STATE_DIR/t3-window-state.json"
if [ -f "$STATE_FILE" ]; then
  # shellcheck disable=SC2046
  PIDS=$(node -e 'const s=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log([s.driverPid,s.childPid].filter(Boolean).join(" "))' "$STATE_FILE")
  for pid in $PIDS; do killtree "$pid" TERM; done
  for _ in $(seq 1 20); do
    ALIVE=0
    for pid in $PIDS; do kill -0 "$pid" 2>/dev/null && ALIVE=1; done
    [ "$ALIVE" -eq 0 ] && break
    sleep 0.5
  done
  for pid in $PIDS; do killtree "$pid" KILL; done
fi
pkill -f "t3-watchdog.mjs --state-dir $STATE_DIR" 2>/dev/null || true
sleep 1

# 2. Single-writer lock: refuse when another live recovery owns it.
# shellcheck disable=SC2046
node --input-type=module -e "
import { claimDead, claimRecovery, readRecoveryClaim, releaseRecovery } from 'file://$HERE/t3-lib.mjs';
const dir = process.argv[1], me = process.argv[2];
if (claimRecovery(dir, me)) process.exit(0);
const owner = readRecoveryClaim(dir);
if (owner && !claimDead(owner)) { console.error(\`emergency refused: recovery owned by \${owner.owner}\`); process.exit(5); }
releaseRecovery(dir);
if (!claimRecovery(dir, me)) { console.error('emergency refused: lost the lock race'); process.exit(5); }
" "$STATE_DIR" "emergency-pid-$$" || exit "$?"

KUBECONFIG_FILE=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).kubeconfigFile)' "$CONFIG")
NAMESPACE=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).namespace ?? "sentropic-preprod")' "$CONFIG")
REVISIONS=$(node -e 'console.log(JSON.stringify(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).revisions ?? {}))' "$CONFIG")
PRE_CM_DIR=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).preCmDir ?? "")' "$CONFIG")
HEALTH_URL=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).endpoints?.appHealth ?? "")' "$CONFIG")
JWKS_URL=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).endpoints?.idpJwks ?? "")' "$CONFIG")
echo "# emergency: automation stopped, lock held"

# 3. Freeze the writer, then classify. The helper prints progress on stderr
# and exactly one JSON line on stdout.
# shellcheck disable=SC2086
CLASSIFY_JSON=$(node "$HERE/t3-emergency-classify.mjs" --kubeconfig-file "$KUBECONFIG_FILE" --namespace "$NAMESPACE" $DRYRUN | tail -n 1) || exit "$?"
COMMITTED=$(node -e 'console.log(JSON.parse(process.argv[1]).committed)' "$CLASSIFY_JSON")
LOCKS=$(node -e 'console.log(JSON.parse(process.argv[1]).locks)' "$CLASSIFY_JSON")
echo "# emergency: classified committed=$COMMITTED locks=$LOCKS (after api stop)"

# 4. Dispatch on the truth, never on the requested mode alone: finish-open
# on a committed database, pre-commit rollback otherwise. An explicit
# --finish-open on an uncommitted database is refused, not forced.
if [ "$COMMITTED" = "true" ]; then
  # shellcheck disable=SC2086
  exec node "$HERE/t3-finish-open.mjs" --config "$CONFIG" --state-dir "$STATE_DIR" $DRYRUN
else
  if [ "$MODE" = "finish-open" ]; then
    echo "emergency refused: --finish-open requested but the database is not committed" >&2
    exit 2
  fi
  PRE_CM_ARG=""
  [ -n "$PRE_CM_DIR" ] && PRE_CM_ARG="--pre-cm-dir $PRE_CM_DIR"
  HEALTH_ARG=""
  [ -n "$HEALTH_URL" ] && [ -n "$JWKS_URL" ] && HEALTH_ARG="--health-url $HEALTH_URL --jwks-url $JWKS_URL"
  # shellcheck disable=SC2086
  exec node "$HERE/t3-rollback.mjs" --kubeconfig-file "$KUBECONFIG_FILE" --namespace "$NAMESPACE" --revisions-json "$REVISIONS" $PRE_CM_ARG $HEALTH_ARG $DRYRUN
fi
