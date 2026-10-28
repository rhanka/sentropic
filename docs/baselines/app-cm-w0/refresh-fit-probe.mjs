import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createClusterMeshModules, verifyClusterMeshTopology } from '@sentropic/cluster-mesh';
import { createArtifactsBuiltin } from '@sentropic/cluster-mesh/mcp/artifacts';
import { createMcpRegistry, computeManifestDigest } from '@sentropic/cluster-mesh/mcp/registry';
import { compileArtifactsProfile, RADAR_ARTIFACTS_PROFILE, createArtifactsManifest } from '@sentropic/artifacts/mcp';
import { MCP_SCOPES } from '@sentropic/mcp-auth';

const modules = createClusterMeshModules();
assert.equal(typeof (await modules.load('comments')).createCommentsModule, 'function');
assert.equal(typeof (await modules.load('gateway')).createGatewayRouter, 'function');
const topology = verifyClusterMeshTopology({ require: ['llm-mesh', 'gateway'] });
assert.equal(topology.instances.length, 1);
assert.equal(topology.llmMesh.path, topology.gateway.llmMesh.path);
const apiArtifact = realpathSync(fileURLToPath(import.meta.resolve('@sentropic/artifacts/mcp')));
const meshArtifact = realpathSync(fileURLToPath(import.meta.resolve('@sentropic/artifacts/mcp',
  import.meta.resolve('@sentropic/cluster-mesh'))));
assert.equal(apiArtifact, meshArtifact);
const selected = ['artifacts_ensure', 'artifacts_get', 'artifacts_list', 'artifacts_publish'];
const profile = compileArtifactsProfile(RADAR_ARTIFACTS_PROFILE);
const definition = { profile, invocationScope: MCP_SCOPES.TOOLS_INVOKE,
  app: { profileDigest: profile.profileDigest, selectedCapabilities: profile.selectedCapabilities,
    execute: async () => { throw new Error('No effect during compilation'); } },
  createInvocation: () => { throw new Error('No binding during compilation'); } };
const manifest = createArtifactsManifest(definition);
assert.equal(manifest.version, '0.2.4');
assert.deepEqual(manifest.tools.map(t => t.name).sort(), selected);
assert.throws(() => createArtifactsManifest({ selectedCapabilities: selected }));
const manifestDigest = computeManifestDigest(manifest);
const registry = createMcpRegistry({ modules, builtins: [createArtifactsBuiltin({ modules, definition })] });
registry.select(['sentropic.artifacts']);
registry.configure('sentropic.artifacts', {});
const result = await registry.compile({ bindings: {},
  compatibility: { 'sentropic.artifacts': { manifestDigest } } });
assert.equal(result.ok, true, JSON.stringify(result));
assert.deepEqual([...result.registry.tools.keys()], selected);
assert.notEqual(manifestDigest, 'ccf8a4ddd9365537741eb0550efa49954d86a0c2d1ee808fb18ca81ef7090e9a');
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
assert.equal(Object.values(lock.packages).some(pkg => pkg.link), false);
const resolvedTree = Object.fromEntries(Object.entries(lock.packages).map(([path, pkg]) =>
  [path, { version: pkg.version, resolved: pkg.resolved, integrity: pkg.integrity }]));
console.log(JSON.stringify({ observedAt: new Date().toISOString(), commentsLoaded: true,
  gatewayLoaded: true, sharedLlmMesh: true, clusterCopies: 1, sourceLinks: 0,
  profileDigest: profile.profileDigest, manifestDigest, manifest, meshArtifact,
  upstreamBumpNeeded: false, lockSha256: createHash('sha256')
    .update(readFileSync('package-lock.json')).digest('hex'), resolvedTree }));
