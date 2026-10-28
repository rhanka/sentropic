#!/usr/bin/env bash
set -euo pipefail
cache=$1
test -s packages/llm-mesh/dist/decision/host.js
cmp scripts/decision/kev-manifest.json "$cache/verified-manifest.json"
for port in 8797 5197 1097; do
  if ss -H -ltn "sport = :$port" | rg -q .; then echo "Port $port is occupied." >&2; exit 1; fi
done
file=$(jq -r .model.file scripts/decision/kev-manifest.json)
printf '%s  %s\n' "$(jq -r .model.sha256 scripts/decision/kev-manifest.json)" "$cache/$file" | sha256sum -c -
archive=$(jq -r .runtime.archive scripts/decision/kev-manifest.json)
printf '%s  %s\n' "$(jq -r .runtime.sha256 scripts/decision/kev-manifest.json)" "$cache/$archive" | sha256sum -c -
export KEV_VERIFY_ROOT="$cache"
tar -xzf "$cache/$archive" --to-command='cmp - "$KEV_VERIFY_ROOT/$TAR_FILENAME"'
umask 077
head -c 32 /dev/urandom | base64 > "$cache/api-key"
supervisor=
cleanup() {
  if [ -n "$supervisor" ]; then kill -TERM "$supervisor" 2>/dev/null || true; wait "$supervisor" || true; fi
  rm -f "$cache/api-key"
}
trap cleanup EXIT INT TERM
timeout --signal=TERM --kill-after=5s 180s "$cache/llama-b11954/llama-server" \
  --model "$cache/$file" --alias kev-q8-7c2ebed90560522c-b11954 \
  --host 127.0.0.1 --port 8797 --api-key-file "$cache/api-key" \
  --ctx-size 2048 --parallel 1 --threads 4 --threads-batch 4 --batch-size 512 --ubatch-size 512 \
  --n-gpu-layers 0 --no-warmup --no-context-shift --cache-ram 0 --no-webui > "$cache/server.log" 2>&1 &
supervisor=$!
ready=false
for _ in $(seq 1 60); do
  kill -0 "$supervisor"
  if curl -fsS --max-time 1 http://127.0.0.1:8797/health >/dev/null 2>&1; then ready=true; break; fi
  sleep 1
done
test "$ready" = true
native_pid=$(pgrep -P "$supervisor")
printf '%s\n' "$native_pid" > "$cache/server-pid"
make decision-kev-smoke-client KEV_CACHE_HOST="$cache" API_PORT=8797 UI_PORT=5197 MAILDEV_UI_PORT=1097 ENV=test-decision-l4
awk '/VmHWM|VmRSS|Threads/' "/proc/$native_pid/status" > "$cache/resource.txt"
