#!/bin/sh
# Run inside Docker. Copy sources, never host dependencies, into disposable storage.
set -eu
workspace=/tmp/cm-workspace
export CANDIDATE_NPM_VERSION="$(npm --version)"
prepared=0
if [ -n "${CI_PACKAGE_CANDIDATES:-}" ] && { [ "$CM_ACTION" != candidate ] || [ -f "$CI_PACKAGE_CANDIDATES/candidates.json" ]; }; then
  cd /source
  MANIFEST_GUARD_TOOL_DIR=/tmp/cm-tools node scripts/ci/package-candidate.mjs verify-prepared "$CI_PACKAGE_CANDIDATES" cluster-mesh
  tar -xzf "$CI_PACKAGE_CANDIDATES/prepared.tgz" -C /tmp
  MANIFEST_GUARD_TOOL_DIR=/tmp/cm-tools node scripts/ci/package-candidate.mjs verify "$CI_PACKAGE_CANDIDATES" cluster-mesh
  if [ "$CM_ACTION" = candidate ]; then exit 0; fi
  prepared=1
else
mkdir -p "$workspace"
cd /source
tar --exclude=.git --exclude=node_modules --exclude=dist --exclude=tmp \
  --exclude='.env*' --exclude=.npmrc --exclude=.aws --exclude=.codex --exclude=.agents \
  --exclude=.tmp --exclude=.h2a --exclude=.remote -cf - . | tar -xf - -C "$workspace"
cd "$workspace"
test ! -d node_modules
mkdir /tmp/cm-tools
echo '965c93e326df9866584261061f4e49571cfd74dfe1dc258c0c6894eea121a4e9  /source/packages/cluster-mesh/tests/fixtures/sentropic-engram-0.22.0.tgz' | sha256sum -c -
# Shallow keeps transitive dependents nested so an installed @sentropic/*
# package can never shadow a workspace symlink below (a hoisted older
# llm-mesh required by a peer tool would otherwise break sibling builds).
npm_config_cache=/tmp/npm-cache node /source/scripts/ci/locked-tools.mjs --prefix /tmp/cm-tools --no-save \
  --ignore-scripts --no-audit --no-fund --install-strategy=shallow typescript@5.4.5 @types/node \
  vitest@4.1.5 pg@8.16.3 @stablelib/sha256@2.0.1 \
  @modelcontextprotocol/sdk@1.31.0 @aws-sdk/client-s3@3.1095.0 @types/pg@8.20.0 \
  esbuild@0.25.12 $CM_PEER_TOOLS >/dev/null
ln -s /tmp/cm-tools/node_modules node_modules
export NODE_PATH=/tmp/cm-tools/node_modules
mkdir -p node_modules/@sentropic
for package in packages/*; do
  [ -f "$package/package.json" ] || continue
  ln -s "$workspace/$package" "node_modules/@sentropic/${package##*/}"
done
tsc=/tmp/cm-tools/node_modules/.bin/tsc
if [ "$CM_ACTION" = candidate ]; then
  export MANIFEST_GUARD_TOOL_DIR=/tmp/cm-tools
  node scripts/ci/package-candidate.mjs produce "$CI_PACKAGE_CANDIDATES" cluster-mesh
  tar -czf "$CI_PACKAGE_CANDIDATES/prepared.tgz" -C /tmp cm-workspace cm-tools
  node scripts/ci/package-candidate.mjs seal "$CI_PACKAGE_CANDIDATES" cluster-mesh
  exit 0
fi
for package in contracts events llm-mesh oauth-verify mcp-auth auth-hono llm-gateway mcp-platform mcp-broker artifacts comments; do
  "$tsc" --typeRoots /tmp/cm-tools/node_modules/@types -p "packages/$package/tsconfig.json"
done
fi
cd "$workspace"
export NODE_PATH=/tmp/cm-tools/node_modules
export MANIFEST_GUARD_TOOL_DIR=/tmp/cm-tools
tsc=/tmp/cm-tools/node_modules/.bin/tsc
cd packages/cluster-mesh
mkdir -p ../../.h2a
if [ -f /source/.h2a/pg-crash-witness.json ]; then
  cp /source/.h2a/pg-crash-witness.json ../../.h2a/
fi
case "$CM_ACTION" in
  mesh-check|gateway-check)
    if [ "$CM_ACTION" = mesh-check ]; then cd ../llm-mesh; else cd ../llm-gateway; fi
    ln -s /tmp/cm-tools/node_modules node_modules
    "$tsc" --noEmit -p tsconfig.json
    if [ "$CM_ACTION" = gateway-check ]; then "$tsc" --noEmit -p tsconfig.test.json; fi
    /tmp/cm-tools/node_modules/.bin/vitest run tests --environment node --maxWorkers=1 ;;
  platform-test)
    cd ../mcp-platform
    /tmp/cm-tools/node_modules/.bin/vitest run "${CM_SCOPE:-tests}" --environment node --maxWorkers=1 ;;
  stateful-consumer)
    if [ "$prepared" = 0 ]; then "$tsc" -p tsconfig.json; fi
    sh tests/packaging/stateful-consumer.sh ;;
  typecheck)
    "$tsc" --noEmit -p tsconfig.json
    "$tsc" --noEmit -p tsconfig.test.json ;;
  build)
    if [ "$prepared" = 0 ]; then "$tsc" -p tsconfig.json; fi
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
      node /source/scripts/ci/locked-consumer.mjs --ignore-scripts --no-audit --no-fund ./sentropic-cluster-mesh-*.tgz \
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
