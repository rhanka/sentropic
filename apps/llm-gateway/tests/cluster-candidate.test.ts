// Consumer-owned contract: cluster-mesh candidate through the gateway host.
// apps/llm-gateway composes @sentropic/cluster-mesh through the gateway
// namespace module and the cluster plugin. The contract boots the standalone
// host on generated keys with an in-memory directory (no provider call,
// database, or secret) and verifies the gateway wire shape on qualified
// candidate bytes, not semver declarations. When CLUSTER_CANDIDATE_TARBALL
// points at the BR-80 qualified archive, the packed manifest must expose the
// same surface the host imports.
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { createGatewayNamespaceModule } from '@sentropic/cluster-mesh/compose/gateway';
import { createHostApp } from '../src/app';
import { fixtureDependencies, testConfig } from './fixtures';
import { readPackedManifest } from '../../../scripts/ci/publishable-manifests.mjs';

const packedManifest = async () => {
  const tarball = process.env.CLUSTER_CANDIDATE_TARBALL;
  if (!tarball) return null;
  return readPackedManifest(await readFile(tarball));
};

describe('cluster-mesh candidate through the gateway host', () => {
  it('should expose the gateway compose module the host mounts', () => {
    expect(typeof createGatewayNamespaceModule).toBe('function');
  });

  it('should boot the host with the gateway namespace mounted', async () => {
    const fixture = fixtureDependencies();
    const host = await createHostApp({ config: testConfig(), dependencies: fixture.dependencies });
    expect(host.app).toBeInstanceOf(Hono);
    const probe = await host.app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-fixture', messages: [] }),
    });
    expect(probe.status).not.toBe(404);
  });

  it('should keep the host composition wired to the same exports', () => {
    const composition = readFileSync(new URL('../src/app.ts', import.meta.url), 'utf8');
    expect(composition).toContain("from '@sentropic/cluster-mesh/compose/gateway'");
    expect(composition).toContain('createGatewayNamespaceModule');
    expect(composition).toContain('createClusterMeshPlugin');
  });

  it('should match the qualified candidate archive when one is supplied', async () => {
    const packed = await packedManifest();
    if (!packed) return;
    expect(packed.name).toBe('@sentropic/cluster-mesh');
    expect(typeof packed.version).toBe('string');
    expect(packed.exports?.['./compose/gateway']).toBeDefined();
  });
});
