// Consumer-owned contract: cluster-mesh candidate through the IdP.
// apps/auth-idp mounts the reusable Cluster Mesh plugin (auth, session, and
// OAuth modules) onto a fresh Hono app. The contract verifies the plugin
// surface the IdP mounts and the namespace-module wire shape on qualified
// candidate bytes, not semver declarations. When CLUSTER_CANDIDATE_TARBALL
// points at the BR-80 qualified archive, the packed manifest must expose the
// same surface the IdP imports.
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import {
  createClusterMeshPlugin,
  type ClusterMeshHonoNamespaceModule,
} from '@sentropic/cluster-mesh';
import { readPackedManifest } from '../../../scripts/ci/publishable-manifests.mjs';

const idpApp = new URL('../idp-app.ts', import.meta.url);

const packedManifest = async () => {
  const tarball = process.env.CLUSTER_CANDIDATE_TARBALL;
  if (!tarball) return null;
  return readPackedManifest(await readFile(tarball));
};

const stubModule = (namespace: ClusterMeshHonoNamespaceModule['namespace']): ClusterMeshHonoNamespaceModule => ({
  namespace,
  enabled: true,
  createRouter: () => {
    const router = new Hono();
    router.get('/health', (context) => context.json({ ok: true }));
    return router;
  },
});

describe('cluster-mesh candidate through the IdP', () => {
  it('should expose the plugin factory the IdP mounts', () => {
    expect(typeof createClusterMeshPlugin).toBe('function');
  });

  it('should mount namespace modules onto a fresh Hono app', async () => {
    const plugin = createClusterMeshPlugin({
      runtime: { context: {}, receiptsPort: { append: async () => {} } } as never,
      namespaces: [stubModule('/session')],
    });
    expect(plugin).toBeInstanceOf(Hono);
    const health = await plugin.request('/session/health');
    expect(health.status).toBe(200);
  });

  it('should keep the IdP composition wired to the same export', () => {
    const composition = readFileSync(idpApp, 'utf8');
    expect(composition).toContain("from '@sentropic/cluster-mesh'");
    expect(composition).toContain('createClusterMeshPlugin');
  });

  it('should match the qualified candidate archive when one is supplied', async () => {
    const packed = await packedManifest();
    if (!packed) return;
    expect(packed.name).toBe('@sentropic/cluster-mesh');
    expect(typeof packed.version).toBe('string');
    expect(packed.exports?.['.']).toBeDefined();
  });
});
