#!/usr/bin/env bash
# Host Make owns this runner. Reap only this invocation on every exit path.
set -euo pipefail
test_env="${1:?ENV required}"
image="${2:?pinned image required}"
shift 2
case "$test_env" in test-*|e2e-*) ;; *) echo 'ERROR: isolated test ENV required' >&2; exit 2;; esac
mkdir -p "$PWD/tmp"
run_dir="$(mktemp -d "$PWD/tmp/gw-run.XXXXXX")"
run_id="gw-evolution-$(basename "$run_dir")"
cleanup() {
  docker rm -f "$run_id" >/dev/null 2>&1 || true
  rm -rf "$run_dir"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
mounts=(-v "$PWD:/workspace")
if [ -n "${GW_EVOL_COMPANION:-}" ]; then mounts+=(-v "$GW_EVOL_COMPANION:/companion"); fi
docker run --rm --init --name "$run_id" --label "gw-evolution-owned=$run_id" \
  --label "gw-evolution-env=$test_env" -u "$(id -u):$(id -g)" -e HOME=/tmp \
  "${mounts[@]}" -w /workspace "$image" sh -ec \
  'if command -v python >/dev/null || command -v python3 >/dev/null; then echo "ERROR: Python in runner" >&2; exit 2; fi; exec "$@"' sh "$@" &
runner_pid=$!
wait "$runner_pid"
