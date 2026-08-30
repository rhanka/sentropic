import { describe, expect, it, vi } from 'vitest';
import {
  ACCESS_TOKEN_TYPE,
  createClusterMeshPlugin,
  createDegenerateClusterMesh,
  RFC8693_GRANT_TYPE,
  type SignedProjectionReference,
} from '../src/index.js';

const ref: SignedProjectionReference = {
  kind: 'memory_snapshot', reference: 'snapshot:1', homeNodeId: 'node:local',
  issuer: 'https://auth.example.test', keyId: 'key-1', signature: 'signed',
};

describe('degenerate cluster mesh', () => {
  it('should compose five federal domains with only local capabilities available', async () => {
    expect(typeof createClusterMeshPlugin).toBe('function');
    const run = vi.fn(async () => ({ exitCode: 0, stdout: '', stderr: '' }));
    const mesh = createDegenerateClusterMesh({
      self: { kind: 'server', nodeId: 'node:local', issuer: ref.issuer, endpoint: 'https://app.example.test', state: 'active' },
      workstations: { async listAttached() { return [{ kind: 'workstation', deviceId: 'device:laptop', displayName: 'Laptop', ownerSubject: 'user-1', state: 'attached' }]; } },
      memberships: { async resolveApproved(input) { return { tenantId: 'tenant-acme', userId: input.userId, status: 'approved' }; } },
      projections: {
        async create() { return ref; }, async verify() { return true; }, async resolve() { return {}; },
      },
      nhiRunner: { run },
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
    await expect(mesh.membership.listDirectory({ workspaceId: 'workspace-1', userId: 'user-1' })).resolves.toHaveLength(2);
    await expect(mesh.membership.interServer.discover()).rejects.toMatchObject({ capability: 'inter_server_discovery' });
    await expect(mesh.trust.tokenExchange.exchange({
      grantType: RFC8693_GRANT_TYPE,
      subjectToken: 'subject-token',
      subjectTokenType: ACCESS_TOKEN_TYPE,
      audience: 'remote-instance',
      scope: ['openid'],
    })).rejects.toMatchObject({ capability: 'rfc8693_token_exchange' });
    await expect(mesh.wrap.projections.resolve({ ...ref, homeNodeId: 'node:remote' })).rejects.toMatchObject({
      capability: 'remote_projection',
    });
    await mesh.wrap.nhi.attest({ instance: 'codex:local:123', privateKey: '/run/key.pem' });
    expect(run).toHaveBeenCalledWith('h2a', [
      'nhi', 'attest', '--instance', 'codex:local:123', '--private-key', '/run/key.pem',
    ]);
  });
});
