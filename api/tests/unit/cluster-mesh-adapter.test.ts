import { describe, expect, it, vi } from 'vitest';
import type {
  ClusterMeshRuntimeStore, LocalWorkstationDescriptor, PtyActuatorPort,
  TenantMembershipRecord, TenantMembershipStore, TenantRegistryStore, WorkspaceDirectoryStore,
} from '@sentropic/cluster-mesh';

import {
  createClusterMeshAppAdapter,
  resolveLiveQualificationConfig,
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
    createWorkstationId() { return 'device:stable-test'; },
    ...overrides,
  };
}

/** P2 boundary doubles: active registry tenant `tenant-1` with slug `tenant-acme`. */
function boundaryStores(membership: TenantMembershipRecord | null): Pick<
  ClusterMeshAppDependencies, 'tenancyStores'
> {
  return {
    tenancyStores: {
      workspaces: {
        findWorkspace: async (workspaceId: string) => workspaceId === 'workspace-1'
          ? { workspaceId: 'workspace-1', tenantId: 'tenant-1', repoIdentity: null,
              aliases: [], enrolledAt: new Date().toISOString() }
          : null,
      } as unknown as WorkspaceDirectoryStore,
      tenants: {
        findTenant: async (tenantId: string) => tenantId === 'tenant-1'
          ? { tenantId: 'tenant-1', slug: 'tenant-acme', status: 'active' as const,
              createdAt: new Date().toISOString() }
          : null,
      } as unknown as TenantRegistryStore,
      memberships: {
        findApprovedMembership: async () => membership,
      } as unknown as TenantMembershipStore,
    },
  };
}

const approvedMembership = (role: 'member' | 'admin' = 'admin'): TenantMembershipRecord => ({
  userId: 'user-1', tenantId: 'tenant-1', status: 'approved', tenantRole: role,
  decidedBy: 'user-0', decidedAt: new Date().toISOString(), updatedAt: 'revision-7',
});

describe('cluster mesh app adapter', () => {
  it('should reject shared-secret qualification in real production and allow the e2e production image', () => {
    const qualification = {
      CLUSTER_MESH_A1_QUALIFICATION: '1',
      H2A_NATIVE_SOCKET: '/tmp/h2a.sock', H2A_ROOT: '/tmp/h2a',
      CLUSTER_MESH_A1_EVIDENCE: 'qualification-secret',
      CLUSTER_MESH_A1_TARGET_REGISTRATION: 'registration-1',
    };

    expect(() => resolveLiveQualificationConfig({ ...qualification, NODE_ENV: 'production' }))
      .toThrow('shared-secret cluster mesh qualification is forbidden in production');
    expect(resolveLiveQualificationConfig({
      ...qualification,
      NODE_ENV: 'production', DISABLE_RATE_LIMIT: 'true', ADMIN_EMAIL: 'e2e-admin@example.com',
    })).toMatchObject({ evidence: 'qualification-secret', registrationId: 'registration-1' });
    expect(resolveLiveQualificationConfig({ ...qualification, NODE_ENV: 'development' }))
      .toMatchObject({ evidence: 'qualification-secret', registrationId: 'registration-1' });
    expect(resolveLiveQualificationConfig({ ...qualification, CLUSTER_MESH_A1_QUALIFICATION: undefined }))
      .toBeUndefined();
  });

  it('should expose an admitted workstation through a second adapter instance', async () => {
    const approved = {
      status: 'approved' as const,
      userId: 'user-1',
      role: 'editor',
      deviceName: 'Laptop',
    };
    const pollDeviceCode = vi.fn(() => approved);
    const attached: LocalWorkstationDescriptor[] = [];
    const admission = {
      generationId: 'generation-1',
      store: {
        async admitWorkstation(input: { sessionId: string; displayName: string; ownerSubject: string }) {
          attached.push({
          kind: 'workstation', deviceId: `device:${input.sessionId}`,
          displayName: input.displayName, ownerSubject: input.ownerSubject, state: 'attached',
        }); },
        async listAdmittedWorkstations() { return attached; },
      },
      async ensureGeneration() {},
    };
    const adapter = createClusterMeshAppAdapter(dependencies({
      pollDeviceCode,
      sessionAdmission: admission,
      ...boundaryStores(approvedMembership()),
    }));
    const secondAdapter = createClusterMeshAppAdapter(dependencies({
      sessionAdmission: admission,
      ...boundaryStores(approvedMembership()),
    }));

    expect(adapter.devices.pollDeviceCode('device-code')).toBe(approved);
    await expect(
      adapter.membership.listDirectory({ workspaceId: 'workspace-1', userId: 'user-1' }),
    ).resolves.toEqual([expect.objectContaining({ kind: 'server' })]);

    await adapter.completeDeviceAttachment(approved, {
      sessionId: 'stable-test', expiresAt: new Date('2099-01-01T00:00:00Z'),
    });

    expect(await secondAdapter.membership.listDirectory({ workspaceId: 'workspace-1', userId: 'user-1' })).toEqual([
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

  it('should derive tid from the CM boundary port, never the workspace id or registry id', async () => {
    const adapter = createClusterMeshAppAdapter(dependencies(boundaryStores(approvedMembership())));

    const context = await adapter.boundaries.resolve({ workspaceId: 'workspace-1', userId: 'user-1' });

    expect(context.tid).toBe('tenant-acme');
    expect(context.tid).not.toBe('workspace-1');
    expect(context.tid).not.toBe('tenant-1');
    expect(context.userId).toBe('user-1');
    expect(context.homeNodeId).toBe('node:sentropic-local');
  });

  it('should deny tenant context when the CM boundary port has no approved membership', async () => {
    const adapter = createClusterMeshAppAdapter(dependencies(boundaryStores(null)));

    await expect(
      adapter.boundaries.resolve({ workspaceId: 'workspace-1', userId: 'user-1' }),
    ).rejects.toMatchObject({ code: 'tenant_membership_required' });
  });

  it('should deny tenant context in an unknown workspace even with an approved membership', async () => {
    const adapter = createClusterMeshAppAdapter(dependencies(boundaryStores(approvedMembership('member'))));

    await expect(
      adapter.boundaries.resolve({ workspaceId: 'workspace-unknown', userId: 'user-1' }),
    ).rejects.toMatchObject({ code: 'tenant_membership_required' });
  });

  it('should inject the PTY registration gate and fail closed before actuation', async () => {
    const pty: PtyActuatorPort = {
      kind: 'pty', isAvailable: vi.fn(async () => true),
      actuate: vi.fn(async () => ({ effectRef: 'must-not-run' })),
    };
    const runtimeStore: ClusterMeshRuntimeStore = {
      append: vi.fn(async () => undefined),
      enqueueCommand: vi.fn(async () => true), find: vi.fn(async () => null),
      markRegistrationLost: vi.fn(async () => true), reclaimExpiredCapacity: vi.fn(async () => 0),
      reserveCapacity: vi.fn(async () => ({ ok: true, outcome: 'reserved' })),
      saveGeneration: vi.fn(async () => undefined), saveMcpServer: vi.fn(async () => undefined),
      saveRegistration: vi.fn(async () => undefined), updateCommand: vi.fn(async () => true),
    };
    const adapter = createClusterMeshAppAdapter(dependencies({
      sessionControl: {
        generationId: 'generation-1', runtimeStore, pty,
        context: { async verify() { throw new Error('not used'); } },
        cutovers: {
          async find() { return null; }, async activate() {}, async rollback() {},
        },
        targets: { async inspect() { return 'unknown'; } },
        ptyEvidence: 'BR75-SG1_source_gap',
      },
    }));

    const decision = await adapter.sessionControl!.runtime.registration.authorize({
      invocationId: 'invocation-1', correlationId: 'correlation-1', generationId: 'generation-1',
      principal: { principalId: 'workload-1', kind: 'workload', verifierId: 'test' },
      workspace: { bindingId: 'binding-1', workspaceId: 'workspace-1', revision: '1' },
      scopes: ['session:drive'], policyRevision: '1', issuedAt: new Date().toISOString(),
    });

    expect(decision).toEqual({ ok: false, reason: 'missing_registration' });
    expect(pty.isAvailable).not.toHaveBeenCalled();
    expect(pty.actuate).not.toHaveBeenCalled();
    expect(adapter.sessionControl?.ptyEvidence).toBe('BR75-SG1_source_gap');
  });
});
