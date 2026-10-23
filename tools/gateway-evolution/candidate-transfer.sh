#!/usr/bin/env bash
# No Git writes: h-cond reviews/stages the immutable candidate bytes.
set -euo pipefail
test_env="$1"; image="$2"; program="$3"; delivery="$4"; manifest="$5"; worktree="$6"; mode="$7"
case "$program:$delivery" in
  gateway:pr[123]) expected="feat/gw-thin-consumer-$delivery" ;;
  registry:r4|registry:r5|registry:r6|registry:r7b) expected="feat/registry-consumer-$delivery" ;;
  *) echo 'ERROR: wrong program/delivery' >&2; exit 2 ;;
esac
worktree="$(realpath "$worktree")"
test "$(git -C "$worktree" rev-parse --show-toplevel)" = "$worktree"
test "$(git -C "$worktree" branch --show-current)" = "$expected" || { echo 'ERROR: wrong companion branch' >&2; exit 2; }
test -z "$(git -C "$worktree" status --porcelain -- .github/gateway-candidates .github/gateway-consumer-input.json)" || { echo 'ERROR: dirty candidate destination' >&2; exit 2; }
GW_EVOL_COMPANION="$worktree" bash tools/gateway-evolution/runner.sh "$test_env" "$image" \
  node tools/gateway-evolution/run.mjs candidate-bundle --program "$program" --delivery "$delivery" \
  --manifest "$manifest" --worktree /companion --mode "${mode:-aggregate}" --source-sha "$(git rev-parse HEAD)"
