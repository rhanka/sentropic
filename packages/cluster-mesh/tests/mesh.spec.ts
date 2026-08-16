import { describe, expect, it } from 'vitest';
import { createDegenerateClusterMesh, type SignedProjectionReference } from '../src/index.js';

const ref: SignedProjectionReference = {
  kind: 'memory_snapshot', reference: 'snapshot:1', homeNodeId: 'node:local',
  issuer: 'https://auth.example.test', keyId: 'key-1', signature: 'signed',
};

describe('degenerate cluster mesh', () => {
  it('should compose five federal domains with only local capabilities available', async () => {
    const mesh = createDegenerateClusterMesh({
      self: { kind: 'server', nodeId: 'node:local', issuer: ref.issuer, endpoint: 'https://app.example.test', state: 'active' },
      workstations: { async listAttached() { return []; } },
      memberships: { async resolveApproved() { return null; } },
      projections: {
        async create() { return ref; }, async verify() { return true; }, async resolve() { return {}; },
      },
      nhiRunner: { async run() { return { exitCode: 0, stdout: '', stderr: '' }; } },
      devices: {
        issueDeviceCode() { return { deviceCode: 'd', userCode: 'u', intervalSec: 5, expiresAt: new Date(0) }; },
        pollDeviceCode() { return { status: 'expired' }; },
        approveDeviceCode() { return { ok: false, reason: 'not_found' }; },
      },
    });

    expect(mesh.capabilities).toEqual({
      mode: 'single-node', localDevices: 'available', localProjection: 'available',
      interServerDirectory: 'gated', tokenExchange: 'gated', memoryReplication: 'gated',
    });
    await expect(mesh.wrap.memoryReplication.replicate(ref)).rejects.toMatchObject({
      capability: 'memory_replication',
    });
  });
});
