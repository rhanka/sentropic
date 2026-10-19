#!/bin/sh
# Run only inside the cold Docker make lane. No workspace links enter the consumer.
set -eu
source_root=$(cd ../.. && pwd)
pack_dir=$(mktemp -d)
consumer=$(mktemp -d)
for package in contracts events oauth-verify mcp-auth mcp-platform cluster-mesh; do
  (cd "$source_root/packages/$package" && npm pack --pack-destination "$pack_dir" --silent)
done
cd "$consumer"
npm init -y >/dev/null
npm pkg set type=module >/dev/null
npm install --ignore-scripts --no-audit --no-fund "$pack_dir"/*.tgz >/dev/null
test ! -L node_modules/@sentropic/cluster-mesh
test ! -L node_modules/@sentropic/mcp-platform
test ! -e node_modules/@sentropic/artifacts
mkdir -p tests/conformance
cp "$source_root"/packages/cluster-mesh/tests/mcp-stateful*.spec.ts tests/
cp "$source_root"/packages/cluster-mesh/tests/conformance/stateful-*.mjs tests/conformance/
cp "$source_root"/packages/cluster-mesh/tests/conformance/immo-stateful-wrap.spec.ts tests/conformance/
cp -R "$source_root"/packages/cluster-mesh/tests/conformance/fixtures tests/conformance/
for file in tests/*.ts tests/conformance/*.ts; do
  sed -i -E "s|'\.\./(\.\./)?src/compose/mcp-stateful.js'|'@sentropic/cluster-mesh/compose/mcp-stateful'|g" "$file"
  sed -i -E "s|'\.\./(\.\./)?src/(modules/registry|hono/plugin).js'|'@sentropic/cluster-mesh'|g" "$file"
done
ln -s /tmp/cm-tools/node_modules/vitest node_modules/vitest
/tmp/cm-tools/node_modules/.bin/vitest run tests --environment node --maxWorkers=1
node --input-type=module -e '
  const schemas = await import("@sentropic/mcp-platform/transport/tool-schemas");
  const codec = await import("@sentropic/mcp-platform/transport/result-codec");
  const bridge = await import("@sentropic/mcp-platform/transport/bridge");
  const mesh = await import("@sentropic/cluster-mesh/compose/mcp-stateful");
  const loaders = await import("@sentropic/cluster-mesh/loaders/mcp");
  for (const fn of [schemas.compileMcpToolSchemas, codec.validateMcpWireResult,
    bridge.registerMcpWireTools, mesh.createStatefulMcpNamespace,
    loaders.loadMcpPlatformToolSchemas, loaders.loadMcpPlatformResultCodec]) {
    if (typeof fn !== "function") throw new Error("Missing installed public symbol");
  }
  console.log("INSTALLED_STATEFUL_C1_C7_OK");
'
