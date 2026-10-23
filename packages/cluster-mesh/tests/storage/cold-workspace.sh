#!/bin/sh
# Run inside Docker. Copy sources, never host dependencies, into disposable storage.
set -eu
workspace=$(mktemp -d)
cd /source
tar --exclude=.git --exclude=node_modules --exclude=dist --exclude=tmp \
  --exclude=.tmp --exclude=.h2a --exclude=.remote -cf - . | tar -xf - -C "$workspace"
cd "$workspace"
test ! -d node_modules
mkdir /tmp/cm-tools
# Shallow keeps transitive dependents nested so an installed @sentropic/*
# package can never shadow a workspace symlink below (a hoisted older
# llm-mesh required by a peer tool would otherwise break sibling builds).
npm_config_cache=/tmp/npm-cache npm install --prefix /tmp/cm-tools --no-save \
  --ignore-scripts --no-audit --no-fund --install-strategy=shallow typescript@5.4.5 @types/node \
  vitest@4.1.5 pg@8.16.3 @stablelib/sha256@2.0.1 \
  @modelcontextprotocol/sdk@1.31.0 @aws-sdk/client-s3@3.1095.0 @types/pg@8.20.0 \
  $CM_PEER_TOOLS >/dev/null
ln -s /tmp/cm-tools/node_modules node_modules
export NODE_PATH=/tmp/cm-tools/node_modules
mkdir -p node_modules/@sentropic
for package in packages/*; do
  [ -f "$package/package.json" ] || continue
  ln -s "$workspace/$package" "node_modules/@sentropic/${package##*/}"
done
tsc=/tmp/cm-tools/node_modules/.bin/tsc
for package in contracts events llm-mesh oauth-verify mcp-auth auth-hono llm-gateway mcp-platform artifacts comments; do
  "$tsc" --typeRoots /tmp/cm-tools/node_modules/@types -p "packages/$package/tsconfig.json"
done
cd packages/cluster-mesh
mkdir -p ../../.h2a
if [ -f /source/.h2a/pg-crash-witness.json ]; then
  cp /source/.h2a/pg-crash-witness.json ../../.h2a/
fi
case "$CM_ACTION" in
  platform-test)
    cd ../mcp-platform
    /tmp/cm-tools/node_modules/.bin/vitest run "${CM_SCOPE:-tests}" --environment node --maxWorkers=1 ;;
  stateful-consumer)
    "$tsc" -p tsconfig.json
    sh tests/packaging/stateful-consumer.sh ;;
  typecheck)
    "$tsc" --noEmit -p tsconfig.json
    "$tsc" --noEmit -p tsconfig.test.json ;;
  build)
    "$tsc" -p tsconfig.json
    rm -rf /source/packages/cluster-mesh/dist
    cp -R dist /source/packages/cluster-mesh/dist ;;
  test)
    /tmp/cm-tools/node_modules/.bin/vitest run "${CM_SCOPE:-tests}" \
      --environment node --maxWorkers=1
    if [ "$CM_PG_CRASH_PHASE" = seed ]; then
      mkdir -p /source/.h2a
      cp ../../.h2a/pg-crash-witness.json /source/.h2a/
    elif [ "$CM_PG_CRASH_PHASE" = verify ]; then
      rm /source/.h2a/pg-crash-witness.json
    fi ;;
  *) echo 'Unknown cluster-mesh action' >&2; exit 1 ;;
esac
