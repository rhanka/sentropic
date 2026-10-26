#!/bin/sh
set -eu
task=$1
scope=${2:-tests}
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
cp -R /workspace/packages/live-speech/. "$scratch/"
cd "$scratch"
npm_config_cache=/tmp/npm-cache npm install --no-package-lock --no-audit --no-fund --ignore-scripts --save-dev \
  typescript@5.4.5 vitest@4.0.18 @types/node@22 eslint@9.39.1 typescript-eslint@8.48.1 >/dev/null
case "$task" in
  test-live-speech) ./node_modules/.bin/vitest run "$scope" --environment node ;;
  typecheck-live-speech)
    ./node_modules/.bin/tsc --noEmit -p tsconfig.json
    ./node_modules/.bin/tsc --noEmit --strict --skipLibCheck --target ES2022 --module NodeNext --moduleResolution NodeNext tests/*.ts ;;
  lint-live-speech) ./node_modules/.bin/eslint src tests ;;
  build-live-speech)
    ./node_modules/.bin/tsc -p tsconfig.json
    npm pack --dry-run
    node --input-type=module -e 'import("./dist/index.js").then(m => { if (!m.SpeechCoordinator || !m.Playback || !m.UsageReceipts) process.exit(1) })' ;;
esac
