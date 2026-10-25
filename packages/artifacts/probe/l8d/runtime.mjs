import assert from 'node:assert/strict';
import { realpathSync, lstatSync, readFileSync } from 'node:fs';
import { createHttpArtifactApp } from '@sentropic/artifacts/http';
import { compileArtifactsProfile, RADAR_ARTIFACTS_PROFILE, createArtifactsManifest,
  ARTIFACTS_PROVIDER_VERSION } from '@sentropic/artifacts/mcp-core';
import { createArtifactCommitBarrier } from '@sentropic/artifacts/testing';
import { createArtifactsBuiltin } from '@sentropic/cluster-mesh/integrations/mcp/artifacts';
import { computeManifestDigest } from '@sentropic/mcp-platform/tool-configuration';
import * as auth from '@sentropic/mcp-auth';
import * as oauth from '@sentropic/oauth-verify';

const profile = compileArtifactsProfile(RADAR_ARTIFACTS_PROFILE);
const manifest = createArtifactsManifest({ profile });
assert.equal(ARTIFACTS_PROVIDER_VERSION, '0.2.0');
assert.deepEqual(manifest.tools.map((t) => t.name),
  ['artifacts_ensure', 'artifacts_publish', 'artifacts_list', 'artifacts_get']);
assert.ok(Object.isFrozen(profile.selectedCapabilities));
assert.equal(typeof createHttpArtifactApp, 'function');
assert.equal(typeof createArtifactsBuiltin, 'function');
assert.equal(typeof createArtifactCommitBarrier().waitUntilReached, 'function');
assert.ok(computeManifestDigest(manifest));
assert.ok(Object.keys(auth).length && Object.keys(oauth).length);
for (const [slug, version] of [['artifacts', '0.2.0'], ['cluster-mesh', '0.22.0'],
  ['mcp-platform', '0.4.0'], ['mcp-auth', '0.2.2']]) {
  const path = `node_modules/@sentropic/${slug}`;
  assert.equal(lstatSync(path).isSymbolicLink(), false);
  assert.ok(realpathSync(path).startsWith(process.cwd() + '/node_modules/'));
  assert.equal(JSON.parse(readFileSync(`${path}/package.json`)).version, version);
}
console.log('L8D_PACKED_RUNTIME_OK tools=4 oauth=resolved sourceLinks=0');
