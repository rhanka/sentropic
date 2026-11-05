// Consumer-owned contract: cluster-mesh candidate through the API.
// The API consumes cluster-mesh namespaces (locks, agents, admin, transfers,
// business, cli), session relay errors, and the MCP supervisor. The contract
// verifies the public export surface and relay behavior on qualified
// candidate bytes, not semver declarations. When CLUSTER_CANDIDATE_TARBALL
// points at the BR-80 qualified archive, the packed manifest must expose the
// same surface the consumer imports.
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

import {
  createClusterMeshPlugin,
  createMcpSupervisor,
  relayError,
} from '@sentropic/cluster-mesh';
import { readPackedManifest } from '../../../scripts/ci/publishable-manifests.mjs';

const packedManifest = async () => {
  const tarball = process.env.CLUSTER_CANDIDATE_TARBALL;
  if (!tarball) return null;
  return readPackedManifest(await readFile(tarball));
};

describe('cluster-mesh candidate through the API', () => {
  it('should expose the namespace plugin, supervisor, and relay surface the API wires', () => {
    expect(typeof createClusterMeshPlugin).toBe('function');
    expect(typeof createMcpSupervisor).toBe('function');
    expect(typeof relayError).toBe('function');
  });

  it('should map relay failures to the versioned session-relay error shape', () => {
    expect(relayError('relay_auth_required')).toEqual({
      format: 'cluster-mesh.session-relay/1',
      kind: 'error',
      code: 'relay_auth_required',
      retryable: false,
    });
    expect(relayError('relay_unavailable', true).retryable).toBe(true);
  });

  it('should keep the API namespaces wired to the same exports', () => {
    for (const consumer of [
      '../../src/routes/namespaces/locks.ts',
      '../../src/routes/namespaces/agents.ts',
      '../../src/routes/session-content/ports.ts',
    ]) {
      const text = readFileSync(new URL(consumer, import.meta.url), 'utf8');
      expect(text).toContain("from '@sentropic/cluster-mesh'");
    }
    expect(readFileSync(new URL('../../src/routes/namespaces/locks.ts', import.meta.url), 'utf8'))
      .toContain('ClusterMeshHonoNamespaceModule');
    expect(readFileSync(new URL('../../src/routes/cluster-mesh-live-qualification.ts', import.meta.url), 'utf8'))
      .toContain('createMcpSupervisor');
  });

  it('should match the qualified candidate archive when one is supplied', async () => {
    const packed = await packedManifest();
    if (!packed) return;
    expect(packed.name).toBe('@sentropic/cluster-mesh');
    expect(typeof packed.version).toBe('string');
    expect(packed.exports?.['.']).toBeDefined();
  });
});
