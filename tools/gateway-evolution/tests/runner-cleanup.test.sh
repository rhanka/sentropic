#!/usr/bin/env bash
# Exercise the actual runner, including interruption, beside an unrelated job.
set -euo pipefail
test_env="${1:?ENV required}"
image="${2:?image required}"
sentinel="gw-unrelated-$$"
cleanup() { docker rm -f "$sentinel" >/dev/null 2>&1 || true; }
trap cleanup EXIT
docker run -d --name "$sentinel" "$image" sleep 300 >/dev/null
runner=(bash tools/gateway-evolution/runner.sh "$test_env" "$image")
"${runner[@]}" node -e 'process.exit(0)'
if "${runner[@]}" node -e 'process.exit(3)'; then
  echo 'FAIL: nonzero exit lost'; exit 1
fi
"${runner[@]}" node -e 'setTimeout(() => {}, 300000)' &
runner_pid=$!
for ((i=0; i<100; i++)); do
  if docker ps -q --filter "label=gw-evolution-env=$test_env" | grep -q .; then break; fi
  sleep 0.1
done
kill -TERM "$runner_pid"
if wait "$runner_pid"; then echo 'FAIL: cancellation lost'; exit 1; fi
test -z "$(docker ps -aq --filter "label=gw-evolution-env=$test_env")"
test "$(docker inspect -f '{{.State.Running}}' "$sentinel")" = true
echo 'ok: runner success/failure/cancellation reaped; unrelated container survives'
