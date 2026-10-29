#!/bin/sh
set -eu
tool=$1; root=$2; output=$3; mode=$4; shift 4
if [ -n "$output" ]; then
  node "$root/tools/memory-mcp-l5/execution.mjs" --root "$root" --output "$output" --mode "$mode" --program "$tool/node_modules/vitest/vitest.mjs" -- "$@" --maxWorkers=1
else
  "$tool/node_modules/.bin/vitest" "$@" --maxWorkers=1
fi
