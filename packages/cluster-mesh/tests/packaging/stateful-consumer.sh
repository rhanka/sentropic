#!/bin/sh
# Run only inside the cold Docker make lane. No workspace links enter the consumer.
set -eu
source_root=$(cd ../.. && pwd)
pack_dir=$(mktemp -d)
consumer=$(mktemp -d)
for package in contracts events oauth-verify mcp-auth mcp-platform cluster-mesh; do
  (cd "$source_root/packages/$package" && npm pack --pack-destination "$pack_dir" --silent)
done
sha256sum "$pack_dir"/*.tgz
cd "$consumer"
npm init -y >/dev/null
npm pkg set type=module >/dev/null
npm install --ignore-scripts --no-audit --no-fund "$pack_dir"/*.tgz >/dev/null
test ! -L node_modules/@sentropic/cluster-mesh
test ! -L node_modules/@sentropic/mcp-platform
test ! -e node_modules/@sentropic/artifacts
node --input-type=module -e '
  import assert from "node:assert/strict";
  import fs from "node:fs";
  import { createClusterMeshModules } from "@sentropic/cluster-mesh";
  import { loadMcpPlatformToolSchemas } from "@sentropic/cluster-mesh/loaders/mcp";
  const dir = "node_modules/@sentropic/mcp-platform";
  const path = dir + "/package.json", saved = fs.readFileSync(path, "utf8");
  try {
    fs.renameSync(dir, dir + ".hidden");
    await assert.rejects(loadMcpPlatformToolSchemas(createClusterMeshModules()), { reason: "not_installed" });
    fs.renameSync(dir + ".hidden", dir);
    for (const mutate of [
      pkg => { pkg.version = "0.3.0"; },
      pkg => { delete pkg.exports["./transport/tool-schemas"]; },
      pkg => { pkg.exports["./transport/tool-schemas"] = { import: "./missing-members.mjs" }; },
    ]) {
      const pkg = JSON.parse(saved);
      mutate(pkg);
      fs.writeFileSync(dir + "/missing-members.mjs", "export const other = true;");
      fs.writeFileSync(path, JSON.stringify(pkg));
      await assert.rejects(loadMcpPlatformToolSchemas(createClusterMeshModules()));
    }
  } finally {
    if (fs.existsSync(dir + ".hidden")) fs.renameSync(dir + ".hidden", dir);
    fs.writeFileSync(path, saved);
  }
'
cat > public-types.ts <<'TYPES'
import { createStatefulMcpNamespace, type StatefulMcpHost, type StatefulMcpHooks,
  type StatefulMcpNamespaceOptions, type VerifiedMcpRequest, type McpWrapRefusal
} from '@sentropic/cluster-mesh/compose/mcp-stateful';
import { createClusterMeshModules } from '@sentropic/cluster-mesh';
import { compileMcpToolSchemas, type McpToolValidationLimits
} from '@sentropic/mcp-platform/transport/tool-schemas';
import { registerMcpWireTools, type McpWireRunner, type McpWireFailure
} from '@sentropic/mcp-platform/transport/bridge';
import { validateMcpWireResult } from '@sentropic/mcp-platform/transport/result-codec';
declare const options: StatefulMcpNamespaceOptions;
declare const budget: McpToolValidationLimits;
const namespace = createStatefulMcpNamespace(createClusterMeshModules(), options);
const validator = compileMcpToolSchemas(options.tools, budget);
void [namespace, validator, registerMcpWireTools, validateMcpWireResult];
type Public = StatefulMcpHost | StatefulMcpHooks | VerifiedMcpRequest | McpWrapRefusal | McpWireRunner | McpWireFailure;
export type { Public };
TYPES
/tmp/cm-tools/node_modules/.bin/tsc --noEmit --target ES2022 --module NodeNext \
  --strict --esModuleInterop --skipLibCheck --typeRoots /tmp/cm-tools/node_modules/@types public-types.ts
mkdir -p tests/conformance
cp "$source_root"/packages/cluster-mesh/tests/mcp-stateful*.spec.ts tests/
cp "$source_root"/packages/cluster-mesh/tests/conformance/stateful-*.mjs tests/conformance/
cp "$source_root"/packages/cluster-mesh/tests/conformance/immo-stateful-wrap.spec.ts tests/conformance/
cp -R "$source_root"/packages/cluster-mesh/tests/conformance/fixtures tests/conformance/
for file in tests/*.ts tests/conformance/*.ts; do
  sed -i -E "s#'\.\./(\.\./)?src/compose/mcp-stateful.js'#'@sentropic/cluster-mesh/compose/mcp-stateful'#g" "$file"
  sed -i -E "s#'\.\./(\.\./)?src/(modules/registry|hono/plugin).js'#'@sentropic/cluster-mesh'#g" "$file"
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
# Qualify the optional variant after the explicit twelve-tool core consumer.
(cd "$source_root/packages/artifacts" && npm pack --pack-destination "$pack_dir" --silent)
sha256sum "$pack_dir"/sentropic-artifacts-*.tgz
npm install --ignore-scripts --no-audit --no-fund "$pack_dir"/*.tgz >/dev/null
test ! -L node_modules/@sentropic/artifacts
cp "$source_root"/packages/cluster-mesh/tests/conformance/immo-stateful-artifacts.spec.ts tests/conformance/
sed -i -E "s#'../../src/compose/mcp-stateful.js'#'@sentropic/cluster-mesh/compose/mcp-stateful'#g; s#'../../src/modules/registry.js'#'@sentropic/cluster-mesh'#g; s#'../../src/integrations/mcp/artifacts.js'#'@sentropic/cluster-mesh/mcp/artifacts'#g" tests/conformance/immo-stateful-artifacts.spec.ts
/tmp/cm-tools/node_modules/.bin/vitest run tests/conformance/immo-stateful-artifacts.spec.ts --environment node --maxWorkers=1
