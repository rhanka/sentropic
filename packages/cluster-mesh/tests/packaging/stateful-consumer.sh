#!/bin/sh
# Run only inside the cold Docker make lane. No workspace links enter the consumer.
set -eu
source_root=$(cd ../.. && pwd)
pack_dir=$(mktemp -d)
consumer=$(mktemp -d)
pack_candidate() {
  if [ -n "${CI_PACKAGE_CANDIDATES:-}" ]; then
    (cd "$source_root" && node scripts/ci/package-candidate.mjs copy "$CI_PACKAGE_CANDIDATES" "$1" "$pack_dir")
  else
    (cd "$source_root/packages/$1" && npm pack --pack-destination "$pack_dir" --silent)
  fi
}
for package in oauth-verify mcp-auth mcp-platform cluster-mesh; do
  pack_candidate "$package"
done
sha256sum "$pack_dir"/*.tgz
node tests/packaging/candidate-platform-registry.mjs ../mcp-platform/package.json \
  "$pack_dir"/sentropic-mcp-platform-*.tgz > "$pack_dir/registry-url" &
registry_pid=$!
trap 'kill "$registry_pid" 2>/dev/null || true' EXIT
while [ ! -s "$pack_dir/registry-url" ]; do kill -0 "$registry_pid"; sleep 0.1; done
export npm_config_registry="$(cat "$pack_dir/registry-url")"
cd "$consumer"
npm init -y >/dev/null
npm pkg set type=module >/dev/null
node "$source_root/scripts/ci/locked-consumer.mjs" --ignore-scripts --no-audit --no-fund "$pack_dir"/sentropic-cluster-mesh-*.tgz >/dev/null
# Authentication belongs to the test host; these are harness-only dev dependencies.
node "$source_root/scripts/ci/locked-consumer.mjs" --save-dev --ignore-scripts --no-audit --no-fund \
  "$pack_dir"/sentropic-mcp-auth-*.tgz "$pack_dir"/sentropic-oauth-verify-*.tgz jose@5.10.0 >/dev/null
test ! -L node_modules/@sentropic/cluster-mesh
test ! -L node_modules/@sentropic/mcp-platform
test ! -e node_modules/@sentropic/artifacts
node --input-type=module -e '
  import assert from "node:assert/strict";
  import fs from "node:fs";
  const pkg = JSON.parse(fs.readFileSync("package.json"));
  assert.deepEqual(Object.keys(pkg.dependencies), ["@sentropic/cluster-mesh"]);
  assert.equal(pkg.devDependencies["@sentropic/mcp-platform"], undefined);
  assert.equal(JSON.parse(fs.readFileSync("node_modules/@sentropic/mcp-platform/package.json")).version, "0.4.0");
'
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
import { createStatefulMcpNamespace, type McpToolValidationLimits, type StatefulMcpHost, type StatefulMcpHooks,
  type StatefulMcpNamespaceOptions, type VerifiedMcpRequest, type McpWrapRefusal
} from '@sentropic/cluster-mesh/compose/mcp-stateful';
import { createClusterMeshModules } from '@sentropic/cluster-mesh';
import { loadMcpPlatformToolSchemas, loadMcpPlatformBridge, loadMcpPlatformResultCodec
} from '@sentropic/cluster-mesh/loaders/mcp';
import { createMcpRegistry, computeManifestDigest, type RegistryDefinition
} from '@sentropic/cluster-mesh/mcp/registry';
declare const options: StatefulMcpNamespaceOptions;
declare const budget: McpToolValidationLimits;
const namespace = createStatefulMcpNamespace(createClusterMeshModules(), options);
const modules = createClusterMeshModules();
const validator = (await loadMcpPlatformToolSchemas(modules)).compileMcpToolSchemas(options.tools, budget);
void [namespace, validator, loadMcpPlatformBridge, loadMcpPlatformResultCodec, createMcpRegistry, computeManifestDigest];
type Public = StatefulMcpHost | StatefulMcpHooks | VerifiedMcpRequest | McpWrapRefusal | RegistryDefinition;
export type { Public };
TYPES
/tmp/cm-tools/node_modules/.bin/tsc --noEmit --target ES2022 --module NodeNext \
  --strict --esModuleInterop --skipLibCheck --typeRoots /tmp/cm-tools/node_modules/@types public-types.ts
mkdir -p tests/conformance
cp "$source_root"/packages/cluster-mesh/tests/mcp-stateful*.spec.ts tests/
cp "$source_root"/packages/cluster-mesh/tests/conformance/stateful-*.mjs tests/conformance/
cp "$source_root"/packages/cluster-mesh/tests/conformance/immo-stateful-wrap.spec.ts tests/conformance/
cp -R "$source_root"/packages/cluster-mesh/tests/conformance/fixtures tests/conformance/
for file in tests/*.ts tests/conformance/*.ts tests/conformance/*.mjs; do
  sed -i -E "s#'\.\./(\.\./)?src/compose/mcp-stateful.js'#'@sentropic/cluster-mesh/compose/mcp-stateful'#g" "$file"
  sed -i -E "s#'\.\./(\.\./)?src/(modules/registry|hono/plugin).js'#'@sentropic/cluster-mesh'#g" "$file"
  sed -i -E "s#'../../src/loaders/mcp/index.js'#'@sentropic/cluster-mesh/loaders/mcp'#g; s#'../../src/mcp/registry.js'#'@sentropic/cluster-mesh/mcp/registry'#g" "$file"
done
ln -s /tmp/cm-tools/node_modules/vitest node_modules/vitest
/tmp/cm-tools/node_modules/.bin/vitest run tests --environment node --maxWorkers=1
node --input-type=module -e '
  const { createClusterMeshModules } = await import("@sentropic/cluster-mesh");
  const mesh = await import("@sentropic/cluster-mesh/compose/mcp-stateful");
  const loaders = await import("@sentropic/cluster-mesh/loaders/mcp");
  const modules = createClusterMeshModules();
  const schemas = await loaders.loadMcpPlatformToolSchemas(modules);
  const codec = await loaders.loadMcpPlatformResultCodec(modules);
  const bridge = await loaders.loadMcpPlatformBridge(modules);
  for (const fn of [schemas.compileMcpToolSchemas, codec.validateMcpWireResult,
    bridge.registerMcpWireTools, mesh.createStatefulMcpNamespace,
    loaders.loadMcpPlatformToolSchemas, loaders.loadMcpPlatformResultCodec]) {
    if (typeof fn !== "function") throw new Error("Missing installed public symbol");
  }
  console.log("INSTALLED_STATEFUL_C1_C7_OK");
'
# Qualify the optional variant after the explicit twelve-tool core consumer.
pack_candidate artifacts
sha256sum "$pack_dir"/sentropic-artifacts-*.tgz
node "$source_root/scripts/ci/locked-consumer.mjs" --ignore-scripts --no-audit --no-fund "$pack_dir"/sentropic-artifacts-*.tgz >/dev/null
test ! -L node_modules/@sentropic/artifacts
node --input-type=module -e '
  import assert from "node:assert/strict";
  import fs from "node:fs";
  const pkg = JSON.parse(fs.readFileSync("package.json"));
  assert.deepEqual(Object.keys(pkg.dependencies).sort(), ["@sentropic/artifacts", "@sentropic/cluster-mesh"]);
  const artifacts = await import("@sentropic/cluster-mesh/mcp/artifacts");
  assert.equal(typeof artifacts.createArtifactsToolExecutor, "function");
'
cp "$source_root"/packages/cluster-mesh/tests/conformance/immo-stateful-artifacts.spec.ts tests/conformance/
sed -i -E "s#'../../src/compose/mcp-stateful.js'#'@sentropic/cluster-mesh/compose/mcp-stateful'#g; s#'../../src/modules/registry.js'#'@sentropic/cluster-mesh'#g; s#'../../src/integrations/mcp/artifacts.js'#'@sentropic/cluster-mesh/mcp/artifacts'#g" tests/conformance/immo-stateful-artifacts.spec.ts
/tmp/cm-tools/node_modules/.bin/vitest run tests/conformance/immo-stateful-artifacts.spec.ts --environment node --maxWorkers=1
