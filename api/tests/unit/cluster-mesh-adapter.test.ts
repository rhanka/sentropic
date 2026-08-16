import { describe, expect, it, vi } from 'vitest';

import {
  createClusterMeshAppAdapter,
  type ClusterMeshAppDependencies,
} from '../../src/services/cluster-mesh-adapter';

function dependencies(
  overrides: Partial<ClusterMeshAppDependencies> = {},
): ClusterMeshAppDependencies {
  return {
    self: {
      kind: 'server',
      nodeId: 'node:sentropic-local',
      issuer: 'https://auth.example.test',
      endpoint: 'https://app.example.test',
      state: 'active',
    },
    issueDeviceCode() {
      return {
        deviceCode: 'device-code',
        userCode: 'PAIR-TEST',
        intervalSec: 5,
        expiresAt: new Date('2026-08-15T00:00:00Z'),
      };
    },
    pollDeviceCode() { return { status: 'authorization_pending' }; },
    approveDeviceCode() { return { ok: true }; },
    async resolveTenant() { return { error: 'unknown' }; },
    createWorkstationId() { return 'device:stable-test'; },
    ...overrides,
  };
}

describe('cluster mesh app adapter', () => {
  it('should attach an approved workstation only after enrollment completion', async () => {
    const approved = {
      status: 'approved' as const,
      userId: 'user-1',
      role: 'editor',
      deviceName: 'Laptop',
    };
    const pollDeviceCode = vi.fn(() => approved);
    const adapter = createClusterMeshAppAdapter(dependencies({
      pollDeviceCode,
      async resolveTenant() { return { tenantId: 'tenant-acme' }; },
    }));

    expect(adapter.devices.pollDeviceCode('device-code')).toBe(approved);
    await expect(
      adapter.membership.listDirectory({ workspaceId: 'workspace-1', userId: 'user-1' }),
    ).resolves.toEqual([expect.objectContaining({ kind: 'server' })]);

    adapter.completeDeviceAttachment(approved);

    expect(await adapter.membership.listDirectory({ workspaceId: 'workspace-1', userId: 'user-1' })).toEqual([
      expect.objectContaining({ kind: 'server', nodeId: 'node:sentropic-local' }),
      expect.objectContaining({
        kind: 'workstation',
        deviceId: 'device:stable-test',
        ownerSubject: 'user-1',
        homeNodeId: 'node:sentropic-local',
      }),
    ]);
    expect(pollDeviceCode).toHaveBeenCalledWith('device-code');
  });

  it('should derive tid only through the authoritative tenant resolver', async () => {
    const resolveTenant = vi.fn(async () => ({ tenantId: 'tenant-acme' }));
    const adapter = createClusterMeshAppAdapter(dependencies({ resolveTenant }));

    const context = await adapter.boundaries.resolve({ workspaceId: 'workspace-1', userId: 'user-1' });

    expect(resolveTenant).toHaveBeenCalledWith({ workspaceId: 'workspace-1', userId: 'user-1' });
    expect(context.tid).toBe('tenant-acme');
    expect(context.tid).not.toBe('workspace-1');
  });

  it('should deny tenant context when the authoritative resolver cannot validate membership', async () => {
    const adapter = createClusterMeshAppAdapter(dependencies());

    await expect(
      adapter.boundaries.resolve({ workspaceId: 'workspace-1', userId: 'user-1' }),
    ).rejects.toMatchObject({ code: 'tenant_membership_required' });
  });
});
