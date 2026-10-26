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
if [ "$CM_ACTION" = memory-lot3 ]; then
  archive=/source/tmp/lot3-inputs/published-mcp-platform-0.4.0.tgz
  printf '67c9ab88ae51087a21a596facfc8330dea4c43128878c261a4136b6d458885e5  %s\n' "$archive" | sha256sum -c -
  published=$(mktemp -d)
  tar -xzf "$archive" -C "$published"
  rm -rf packages/mcp-platform/dist
  cp -R "$published/package/dist" packages/mcp-platform/dist
  # Existing tests import ../src/*.js; execute the identical published JS there too.
  cp -R "$published/package/dist/." packages/mcp-platform/src/
  export MEMORY_L5_PLATFORM_ARCHIVE="$archive"
fi
cd packages/cluster-mesh
mkdir -p ../../.h2a
if [ -f /source/.h2a/pg-crash-witness.json ]; then
  cp /source/.h2a/pg-crash-witness.json ../../.h2a/
fi
case "$CM_ACTION" in
  memory-lot3)
    "$tsc" -p tsconfig.json
    CLUSTER_MESH_PREPARE_ONLY=mcp sh tests/packaging/prepare.sh "$workspace/lot3-packaging"
    export CLUSTER_MESH_PACKAGING_DIR="$workspace/lot3-packaging"
    node ../../tools/memory-mcp-l5/lot3-source.mjs "$workspace" /source/tmp/memory-l5-lot3-results /source ;;
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
    node tests/engram-memory/package-contract.mjs
    rm -rf /source/packages/cluster-mesh/dist
    cp -R dist /source/packages/cluster-mesh/dist
    mkdir -p /source/packages/cluster-mesh/contracts
    cp contracts/engram-memory-neutral-contract-v1.d.ts /source/packages/cluster-mesh/contracts/ ;;
  test)
    if [ "${CM_SCOPE:-}" = tests/engram-memory/durable-memory.spec.ts ]; then
      "$tsc" -p tsconfig.json
      node tests/engram-memory/package-contract.mjs
      consumer=$(mktemp -d)
      npm pack --loglevel error --pack-destination "$consumer" >/dev/null
      cp -R tests "$consumer/tests"
      cd "$consumer"
      printf '%s\n' '{"private":true,"type":"module"}' > package.json
      npm install --ignore-scripts --no-audit --no-fund ./sentropic-cluster-mesh-*.tgz \
        @sentropic/engram@0.21.3 vitest@4.1.5 pg@8.22.0 >/dev/null
      # Fixture relative paths target installed declarations/runtime/assets.
      # No checkout sources are copied into this consumer.
      ln -s node_modules/@sentropic/cluster-mesh/dist src
      ln -s node_modules/@sentropic/cluster-mesh/assets assets
      export MEMORY_INSTALLED_ROOT="$consumer"
      receipt=/source/tmp/memory-stage-b
      mkdir -p "$receipt"
      set +e
      ./node_modules/.bin/vitest run tests/engram-memory/durable-memory.spec.ts \
        --reporter=default --reporter=json --outputFile=stage-b-result.json --environment node --maxWorkers=1
      result=$?
      set -e
      cp stage-b-result.json package-lock.json ./sentropic-cluster-mesh-*.tgz "$receipt/"
      sha256sum ./sentropic-cluster-mesh-*.tgz > "$receipt/mesh.sha256"
      exit "$result"
    fi
    /tmp/cm-tools/node_modules/.bin/vitest run "${CM_SCOPE:-tests}" \
      --exclude tests/engram-memory/durable-memory.spec.ts --environment node --maxWorkers=1
    if [ "$CM_PG_CRASH_PHASE" = seed ]; then
      mkdir -p /source/.h2a
      cp ../../.h2a/pg-crash-witness.json /source/.h2a/
    elif [ "$CM_PG_CRASH_PHASE" = verify ]; then
      rm /source/.h2a/pg-crash-witness.json
    fi ;;
  *) echo 'Unknown cluster-mesh action' >&2; exit 1 ;;
esac
