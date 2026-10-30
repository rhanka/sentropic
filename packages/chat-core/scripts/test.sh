#!/bin/sh
set -eu
tool_dir="$(mktemp -d)"
export npm_config_cache=/tmp/npm-cache
node /workspace/scripts/ci/locked-tools.mjs --prefix "$tool_dir" --no-save --no-audit --no-fund vitest@4.0.18 @vitest/coverage-v8@4.0.18 typescript@5.4.5 svelte@5.55.7 hono@4.10.7 @types/node >/dev/null
rm -rf node_modules coverage
mkdir -p node_modules/@vitest
for dep in vitest svelte hono; do ln -s "$tool_dir/node_modules/$dep" "node_modules/$dep"; done
ln -s "$tool_dir/node_modules/@vitest/coverage-v8" node_modules/@vitest/coverage-v8
server_link=''
trap 'rm -rf node_modules; if [ -n "$server_link" ]; then rm -f "$server_link"; fi' EXIT
if [ ! -e /workspace/packages/chat-server/node_modules/hono ]; then
  mkdir -p /workspace/packages/chat-server/node_modules
  server_link=/workspace/packages/chat-server/node_modules/hono
  ln -s "$tool_dir/node_modules/hono" "$server_link"
fi
"$tool_dir/node_modules/.bin/vitest" run ${SCOPE:-tests} --environment node --coverage
