import { describe, expect, it } from 'vitest';
import { memoryJcs } from '../../src/engram-memory/codec.js';
import type { MemoryHostBinding } from '../../src/engram-memory/binding.js';
import {
  createMemoryNeutralHandle, type MemoryNeutralHostDriver, type MemoryNeutralKernelPort,
} from '../../src/engram-memory/neutral-handle.js';

const scope = { tenantId: 'tenant-1', workspaceId: 'workspace-1' };
const grant = {
  token: 'neutral-token', moduleId: 'engram-memory', scope, principalId: 'principal-1',
  operations: ['read', 'write'], issuer: 'host-1', authorityRevision: '1', policyRevision: '1',
  moduleAuthority: null, lifetime: { kind: 'invocation', invocationId: 'inv-1' },
};
const binding = {
  memoryGrant: grant, maintainGrant: { ...grant, operations: ['read', 'maintain'] },
  storeId: 'store-1',
} as unknown as MemoryHostBinding;

const harness = () => {
  const identity = new Map<string, string>();
  const state = { released: 0, provisioned: [] as unknown[], verified: 0, bound: [] as unknown[] };
  const driver: MemoryNeutralHostDriver = {
    transaction: async (_options, operation) => operation({
      execute: async ({ text, values }) => {
        if (text.startsWith('CREATE TABLE')) return { rows: [] };
        if (text.startsWith('INSERT')) {
          if (!identity.has(values[0] as string)) identity.set(values[0] as string, values[1] as string);
          return { rows: [] };
        }
        const rows = [...identity.entries()]
          .filter(([rowScope, store]) => rowScope === values[0] || store === values[1])
          .map(([rowScope, store]) => ({ scope: rowScope, store_id: store }));
        return { rows };
      },
    }),
  };
  const kernel: MemoryNeutralKernelPort = {
    bind: async (boundGrant) => {
      state.bound.push(boundGrant);
      return {
        transact: async (_options, operation) => ({ value: await operation({
          readAggregate: async () => null,
          readRecords: async () => [],
          readChain: async () => ({ records: [], nextCursor: null }),
          findIdempotency: async () => null,
          apply: async () => undefined,
        }), receipt: { commitId: 'commit-1', journalCursor: '1' } }),
        readAggregate: async () => null,
        readCommitResult: async () => memoryJcs({ receipt_digest: 'sha256:receipt' }),
        query: async () => ({ records: [] }),
      };
    },
    ownership: {
      handle: { instanceId: 'instance-1', storageEpoch: '3' },
      verify: async () => { state.verified += 1; },
      release: async () => { state.released += 1; },
    },
    provisionFence: async (fencedGrant, fence) => { state.provisioned.push([fencedGrant, fence]); },
  };
  return { driver, kernel, state, identity };
};
const make = () => {
  const parts = harness();
  const assembly = createMemoryNeutralHandle({
    kernel: parts.kernel, binding, driver: parts.driver, schemaName: 'host_schema',
  });
  return { ...parts, assembly, handle: assembly.handle };
};

describe('memory neutral-handle factory refusals', () => {
  it('refuses a missing kernel, driver, binding and an invalid schema name', () => {
    const { driver, kernel } = harness();
    const base = { kernel, binding, driver, schemaName: 'host_schema' };
    expect(() => createMemoryNeutralHandle({ ...base, kernel: undefined as never }))
      .toThrow(expect.objectContaining({ code: 'unavailable' }));
    expect(() => createMemoryNeutralHandle({ ...base, driver: undefined as never }))
      .toThrow(expect.objectContaining({ code: 'HOST_DRIVER_REQUIRED' }));
    expect(() => createMemoryNeutralHandle({ ...base, binding: undefined as never }))
      .toThrow(expect.objectContaining({ code: 'denied' }));
    expect(() => createMemoryNeutralHandle({ ...base, schemaName: 'bad-name' }))
      .toThrow(expect.objectContaining({ code: 'invalid-command' }));
  });
  it('refuses foreign grants and foreign acquisition scopes as unauthorized', async () => {
    const { handle } = make();
    const foreign = { ...grant, scope: { tenantId: 'other', workspaceId: 'workspace-1' } };
    await expect(handle.query('scope-chain-index', memoryJcs({}), foreign as never))
      .rejects.toMatchObject({ code: 'unauthorized' });
    await expect(handle.acquireFence({
      scope: { tenantId: 'other', workspaceId: 'workspace-1' }, store_id: 'store-1', grant,
    })).rejects.toMatchObject({ code: 'unauthorized' });
  });
});

describe('memory neutral-handle fence', () => {
  it('acquires, checks and releases the canonical fence once', async () => {
    const { handle, assembly, state } = make();
    const fence = await handle.acquireFence({ scope, store_id: 'store-1', grant });
    expect(fence).toEqual({ fenceId: 'instance-1', epoch: '3' });
    expect(assembly.getFence()).toEqual(fence);
    expect(state.provisioned).toHaveLength(1);
    await expect(handle.acquireFence({ scope, store_id: 'store-1', grant }))
      .rejects.toMatchObject({ code: 'fence-conflict' });
    await handle.checkFence(grant, fence);
    await expect(handle.checkFence(grant, { fenceId: 'instance-1', epoch: '9' }))
      .rejects.toMatchObject({ code: 'fence-lost' });
    await handle.releaseFence(fence);
    expect(state.released).toBe(1);
    await handle.releaseFence(fence);
    expect(state.released).toBe(1);
  });
  it('refuses a second store identity for the bound scope', async () => {
    const parts = harness();
    const first = createMemoryNeutralHandle({
      kernel: parts.kernel, binding, driver: parts.driver, schemaName: 'host_schema',
    });
    const second = createMemoryNeutralHandle({
      kernel: parts.kernel, binding, driver: parts.driver, schemaName: 'host_schema',
    });
    await first.handle.acquireFence({ scope, store_id: 'store-1', grant });
    await expect(second.handle.acquireFence({ scope, store_id: 'store-2', grant }))
      .rejects.toMatchObject({ code: 'fence-conflict' });
  });
  it('serves transact, query and commit-result reads through the kernel', async () => {
    const { handle } = make();
    await handle.acquireFence({ scope, store_id: 'store-1', grant });
    const result = await handle.transact(
      { limits: { maxAppends: 10, maxRecords: 10, maxEncodedBytes: 1024 }, grant },
      async () => 'done');
    expect(result.value).toBe('done');
    const chain = await handle.query('scope-chain-index', memoryJcs({}), grant);
    expect(JSON.parse(chain.data))
      .toEqual({ chain: 'memory-journal', head: `sha256:${'0'.repeat(64)}`, allocation: '0' });
    const receipt = await handle.readCommitResult!('commit-1', grant);
    expect(JSON.parse(receipt!.data)).toEqual({ receipt_digest: 'sha256:receipt' });
  });
});
