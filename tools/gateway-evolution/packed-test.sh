#!/usr/bin/env bash
set -euo pipefail
test_env="$1"; image="$2"; manifest="$3"; scope="$4"
mkdir -p "$PWD/tmp"
stage="$(mktemp -d "$PWD/tmp/gw-packed-XXXXXXXX")"
trap 'rm -rf "$stage"' EXIT
bash tools/gateway-evolution/runner.sh "$test_env" "$image" node tools/gateway-evolution/run.mjs packed-gate \
  --manifest "$manifest" --scope "$scope" --output "tmp/$(basename "$stage")"
# Only the verified disposable consumer is mounted for install and execution.
GW_EVOL_WORKSPACE="$stage" bash tools/gateway-evolution/runner.sh "$test_env" "$image" sh -ec \
  'npm install --no-audit --no-fund --cache /tmp/npm-cache; node execute.mjs'
