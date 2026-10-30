#!/bin/sh
set -eu
task=$1
scope=${2:-tests}
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
mkdir -p "$scratch/live-speech"
cp -R /workspace/packages/live-speech/. "$scratch/live-speech/"
cd "$scratch/live-speech"
npm_config_cache=/tmp/npm-cache node /workspace/scripts/ci/locked-tools.mjs --prefix "$scratch/tools" --no-audit --no-fund --ignore-scripts \
  typescript@5.4.5 vitest@4.0.18 @types/node@22 eslint@9.39.1 typescript-eslint@8.48.1 >/dev/null
ln -s "$scratch/tools/node_modules" node_modules
case "$task" in
  typecheck-live-speech|build-live-speech)
    # Retain L4's type-only L1 contract without compiling mesh sources into this package.
    mkdir -p "$scratch/llm-mesh"
    cp /workspace/packages/llm-mesh/package.json "$scratch/llm-mesh/"
    ./node_modules/.bin/tsc --strict --declaration --emitDeclarationOnly --skipLibCheck --target ES2022 \
      --module NodeNext --moduleResolution NodeNext --rootDir /workspace/packages/llm-mesh/src \
      --outDir "$scratch/llm-mesh/src" /workspace/packages/llm-mesh/src/speech/contracts.ts ;;
esac
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
