#!/bin/sh
# Sourced by the shared manifest guard so its real pack runs against this isolated build.
pack_scratch=$(mktemp -d)
trap 'rm -rf "$pack_scratch"' EXIT
cp -R /workspace/packages/live-speech "$pack_scratch/live-speech"
node /workspace/scripts/ci/locked-tools.mjs --prefix "$pack_scratch/tools" --no-save --no-audit --no-fund --ignore-scripts \
  semver@7.7.2 typescript@5.4.5 >/dev/null
export MANIFEST_GUARD_TOOL_DIR="$pack_scratch/tools"
cd "$pack_scratch/live-speech"
"$MANIFEST_GUARD_TOOL_DIR/node_modules/.bin/tsc" -p tsconfig.json
