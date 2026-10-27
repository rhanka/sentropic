#!/bin/sh
set -eu
workspace=$(mktemp -d)
trap 'rm -rf "$workspace"' EXIT
cd /workspace
tar --exclude=node_modules --exclude=dist --exclude=build --exclude=.svelte-kit \
  -cf - package.json package-lock.json api ui apps packages | tar -xf - -C "$workspace"
cd "$workspace"
node --input-type=module -e 'import assert from "node:assert/strict"; import { readFileSync } from "node:fs"; const json = p => JSON.parse(readFileSync(p)); assert.equal(json("api/package-lock.json").packages["../packages/artifacts"].version, json("packages/artifacts/package.json").version);'
node --version > /out/workspace-tools.txt
npm --version >> /out/workspace-tools.txt
sha256sum package-lock.json api/package-lock.json > /out/workspace-lock-before.txt
npm ci --strict-peer-deps --ignore-scripts --no-audit --no-fund > /out/workspace-install.log 2>&1
npm ls --all --json > /out/workspace-tree.json 2> /out/workspace-tree-errors.txt || true
npm ls --omit=dev --all --json > /out/workspace-runtime-tree.json 2> /out/workspace-runtime-errors.txt
cp package-lock.json /out/workspace-package-lock.json
for package in contracts events llm-mesh oauth-verify auth-client mcp-auth auth-hono comments \
  chat-core chat-server llm-gateway flow mcp-platform artifacts connector-host mcp-connector-google cluster-mesh; do
  node_modules/.bin/tsc -p "packages/$package/tsconfig.json" >> /out/workspace-build.log 2>&1
done
mkdir -p /out/workspace-payload
for package in artifacts cluster-mesh llm-mesh llm-gateway; do
  (cd "packages/$package"; npm pack --ignore-scripts --json --pack-destination /out/workspace-payload) \
    > "/out/workspace-payload/$package-pack.json"
done
cd api
set +e
../node_modules/.bin/vitest run tests/api/app-mcp-registry.test.ts tests/api/app-mcp-installed.test.ts \
  --environment node --maxWorkers=1 > "/out/registry-$W0_REFRESH_EXPECT.log" 2>&1
registry_status=$?
set -e
if [ "$W0_REFRESH_EXPECT" = red ]; then
  test "$registry_status" -ne 0
  grep -q 'requires the pinned APP-P1 manifest' /out/registry-red.log
else
  test "$registry_status" -eq 0
fi
cd ..
sha256sum package-lock.json api/package-lock.json > /out/workspace-lock-after.txt
cmp /out/workspace-lock-before.txt /out/workspace-lock-after.txt
