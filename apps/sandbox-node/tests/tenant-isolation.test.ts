import { describe, expect, it } from 'vitest';
import type {
  ExecutionNodeOwnership,
  ExecutionNodeSandboxSpec,
} from '../src/index.js';
import { createExecutionNode, ExecutionNodeError, TenantBaseRegistry } from '../src/index.js';

function ownership(tenantId: 'sentropic' | 'immo'): ExecutionNodeOwnership {
  return {
    tenantId,
    poolOwned: false,
    workspaceId: `ws-${tenantId}`,
    principalId: `user-${tenantId}`,
    attemptId: 'attempt-1',
    purpose: 'test',
    generation: 1,
    custodyEpoch: 1,
  };
}

function spec(tenantId: 'sentropic' | 'immo'): ExecutionNodeSandboxSpec {
  return {
    command: ['/bin/sleep', 'infinity'],
    tenantId,
    devScope: { kind: 'ui', writable: ['ui/**'], refused: ['ui/dist/**'], source: { repo: 'fixture', path: 'registry.ts', commit: 'abc' } },
    physicalUid: 'uid-1',
    profile: 'node-22',
    runtimeClass: 'gvisor',
    baseMounts: [],
    quotaMiB: 512,
    quotaInodes: 1000,
    uid: 1000,
    gid: 1000,
    network: 'none',
    allowExec: true,
    allowPty: false,
    allowSnapshots: false,
  };
}

describe('tenant isolation', () => {
  it('lists only the caller tenant sandboxes (0 cross-tenant reads)', async () => {
    const { daemon } = createExecutionNode();
    const a = await daemon.createSandbox({ spec: spec('sentropic'), ownership: ownership('sentropic'), commandId: 'c1' });
    await daemon.createSandbox({ spec: spec('immo'), ownership: ownership('immo'), commandId: 'c2' });
    expect(daemon.listSandboxes('sentropic').map(s => s.id)).toEqual([a.id]);
    expect(daemon.listSandboxes('immo')).toHaveLength(1);
    expect(daemon.getSandbox('sentropic', a.id)?.id).toBe(a.id);
  });

  it('rejects cross-tenant access by id without leaking existence', async () => {
    const { daemon, audit } = createExecutionNode();
    const created = await daemon.createSandbox({ spec: spec('sentropic'), ownership: ownership('sentropic'), commandId: 'c1' });
    expect(daemon.getSandbox('immo', created.id)).toBeUndefined();
    expect(() => daemon.peekSandbox('immo', created.id)).toThrowError(ExecutionNodeError);
    try {
      daemon.peekSandbox('immo', created.id);
    } catch (error) {
      expect((error as ExecutionNodeError).code).toBe('cross_tenant_base_forbidden');
      expect((error as ExecutionNodeError).status).toBe(403);
    }
    const denied = audit.list({ tenantId: 'immo' });
    expect(denied.some(event => event.type === 'sandbox.cross_tenant_denied')).toBe(true);
  });

  it('rejects cross-tenant base mounts and reads', async () => {
    const { daemon, bases } = createExecutionNode();
    bases.register({ tenantId: 'sentropic', baseId: 'rootfs', kind: 'rootfs', identityDigest: 'abc' });
    const withForeignBase = { ...spec('immo'), baseMounts: [{ baseId: 'rootfs', kind: 'rootfs' as const, identityDigest: 'abc' }] };
    await expect(
      daemon.createSandbox({ spec: withForeignBase, ownership: ownership('immo'), commandId: 'c1' }),
    ).rejects.toThrowError(/cross_tenant_base_forbidden/);
    expect(bases.get('immo', 'rootfs')).toBeUndefined();
    expect(bases.get('sentropic', 'rootfs')?.identityDigest).toBe('abc');
    expect(bases satisfies TenantBaseRegistry).toBeDefined();
  });

  it('rejects spec/ownership tenant mismatch at create', async () => {
    const { daemon } = createExecutionNode();
    await expect(
      daemon.createSandbox({ spec: spec('sentropic'), ownership: ownership('immo'), commandId: 'c1' }),
    ).rejects.toThrowError(/cross_tenant_base_forbidden/);
  });
});
