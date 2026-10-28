#!/bin/sh
set -eu
task="$1"
tool_dir="$(mktemp -d)"
export npm_config_cache=/tmp/npm-cache
npm install --prefix "$tool_dir" --no-save --no-audit --no-fund typescript@5.4.5 vitest@4.0.18 svelte@5.55.7 @types/node >/dev/null
mkdir -p node_modules
mkdir -p node_modules/@sentropic
ln -sfn /workspace/packages/chat-ui node_modules/@sentropic/chat-ui
ln -sfn /workspace/packages/chat-runtime node_modules/@sentropic/chat-runtime
ln -sfn /workspace/packages/chat-runtime/node_modules /workspace/packages/chat-ui/node_modules
for dep in svelte vitest; do ln -sfn "$tool_dir/node_modules/$dep" "node_modules/$dep"; done
trap 'rm -rf node_modules /workspace/packages/chat-ui/node_modules' EXIT
case "$task" in
  typecheck) "$tool_dir/node_modules/.bin/tsc" --noEmit -p tsconfig.json ;;
  build) "$tool_dir/node_modules/.bin/tsc" -p tsconfig.json ;;
  test) "$tool_dir/node_modules/.bin/vitest" run ${SCOPE:-tests} --environment node ;;
  *) echo "Unknown runtime task: $task" >&2; exit 1 ;;
esac
