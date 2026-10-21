// G1a constructor/refusal compatibility with the installed substrate: the
// host grant, scope binding and clock shape the installed Engram substrate
// accepts, over both the flat-handle and the grant-binding paths. Sync and
// async bind are both consumed. No successful store composition is claimed.

import { describe, expect, it } from 'vitest';
import { MEMORY_DESCRIPTOR } from '../../src/engram-memory/manifest.js';
import {
  G1_INVOCATION_ID,
  G1_TENANT_ID,
  G1_WORKSPACE_ID,
  g1Clock,
  g1Deadline,
  g1Grant,
  g1HostHandle,
  g1ScopeBinding,
  openG1MemoryStore,
} from './g1-host.js';
import { openModuleStorageCanonicalMemoryStoreV1 } from '@sentropic/engram/memory-substrate';
import type { MemorySqliteDriverProvider } from '../../src/engram-memory/sqlite.js';

const qualifiedDriver = (): MemorySqliteDriverProvider => ({
  identity: { name: 'g1-host-sqlite-owner', version: '1', artifactDigest: 'd'.repeat(64) },
  engineFloor: '3.51.3',
});

describe('G1 binding compatibility with the installed substrate', () => {
  it('should expose the neutral descriptor fields the substrate gates on', () => {
    expect(MEMORY_DESCRIPTOR.contractVersion).toBe('memory-binding-v1');
    expect(MEMORY_DESCRIPTOR.contractDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect([...MEMORY_DESCRIPTOR.schemaVersions].length).toBeGreaterThan(0);
    expect([...MEMORY_DESCRIPTOR.requiredProfiles].length).toBeGreaterThan(0);
    expect([...MEMORY_DESCRIPTOR.queryNames].length).toBeGreaterThan(0);
    expect([...MEMORY_DESCRIPTOR.boundaries].length).toBeGreaterThan(0);
    expect(MEMORY_DESCRIPTOR.pageLimits.maxRecords).toBe(2000);
  });

  it('should issue a grant bound to module engram-memory with exactly read and write', () => {
    const grant = g1Grant();
    expect(grant.moduleId).toBe('engram-memory');
    expect(grant.scope).toEqual({ tenantId: G1_TENANT_ID, workspaceId: G1_WORKSPACE_ID });
    expect([...grant.operations].sort()).toEqual(['read', 'write']);
    expect(grant.lifetime).toEqual({ kind: 'invocation', invocationId: G1_INVOCATION_ID });
  });

  it('should refuse a grant for another module without touching the backend', async () => {
    const result = await openG1MemoryStore(qualifiedDriver(), {
      grant: { ...g1Grant(), moduleId: 'other-module' },
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatchObject({ code: 'UNAUTHORIZED', operation: 'admin', retryable: false });
  });

  it('should refuse a grant that does not cover exactly read and write on the scope', async () => {
    const readOnly = await openG1MemoryStore(qualifiedDriver(), {
      grant: { ...g1Grant(), operations: ['read'] },
    });
    expect(readOnly.ok).toBe(false);
    expect(readOnly.error?.code).toBe('UNAUTHORIZED');
    const otherScope = await openG1MemoryStore(qualifiedDriver(), {
      grant: { ...g1Grant(), scope: { tenantId: 'elsewhere', workspaceId: G1_WORKSPACE_ID } },
    });
    expect(otherScope.ok).toBe(false);
    expect(otherScope.error?.code).toBe('UNAUTHORIZED');
  });

  it('should refuse a missing grant token and a malformed construction deadline', async () => {
    const noToken = await openG1MemoryStore(qualifiedDriver(), {
      grant: { ...g1Grant(), token: '' },
    });
    expect(noToken.ok).toBe(false);
    expect(noToken.error?.code).toBe('INVALID_SCHEMA');
    const noDeadline = await openG1MemoryStore(qualifiedDriver(), { deadline_at: 'not-an-instant' });
    expect(noDeadline.ok).toBe(false);
    expect(noDeadline.error?.code).toBe('INVALID_SCHEMA');
  });

  it('should refuse a scope binding without tenant and workspace', async () => {
    const result = await openG1MemoryStore(qualifiedDriver(), {
      scope_binding: { scope: { tenantId: '', workspaceId: '' }, store_id: 's', resolveScope: () => null },
    });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('INVALID_SCHEMA');
  });

  it('should consume a synchronous grant binding', async () => {
    const seen: Array<{ token: string }> = [];
    const released: unknown[] = [];
    const binding = {
      ...g1HostHandle(),
      bind: (grant: { token: string }) => {
        seen.push({ token: grant.token });
        return {
          transact: async () => {
            throw new Error('s-gated');
          },
          query: async () => {
            throw new Error('s-gated');
          },
          readAggregate: async () => null,
          acquireFence: async () => ({ fenceId: 'fence-01', epoch: '07' }),
          checkFence: async () => undefined,
          releaseFence: async (fence: unknown) => {
            released.push(fence);
            return undefined;
          },
        };
      },
    };
    const result = (await openModuleStorageCanonicalMemoryStoreV1({
      handle: binding,
      scope_binding: g1ScopeBinding(),
      grant: g1Grant(),
      clock: g1Clock(),
      deadline_at: g1Deadline(),
    })) as unknown as { ok: boolean; error?: { code?: unknown; message?: unknown } };
    expect(seen).toHaveLength(1);
    // The fence proof epoch must be a canonical u64: '07' is not, so the
    // construction releases the fence and refuses before any storage work.
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('CAPABILITY_UNAVAILABLE');
    expect(String(result.error?.message)).toContain('canonical acquisition');
    expect(released).toHaveLength(1);
  });

  it('should consume an asynchronous grant binding', async () => {
    const order: string[] = [];
    const binding = {
      ...g1HostHandle(),
      bind: async (grant: { token: string }) => {
        order.push(`bind:${grant.token}`);
        return {
          transact: async () => {
            throw new Error('s-gated');
          },
          query: async () => {
            throw new Error('s-gated');
          },
          readAggregate: async () => null,
          acquireFence: async () => {
            order.push('acquireFence');
            throw new Error('s-gated fence');
          },
          checkFence: async () => undefined,
          releaseFence: async () => undefined,
        };
      },
    };
    const result = (await openModuleStorageCanonicalMemoryStoreV1({
      handle: binding,
      scope_binding: g1ScopeBinding(),
      grant: g1Grant(),
      clock: g1Clock(),
      deadline_at: g1Deadline(),
    })) as unknown as { ok: boolean; error?: { code?: unknown; message?: unknown } };
    expect(order[0]).toBe(`bind:${g1Grant().token}`);
    expect(order).toContain('acquireFence');
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('STORE_UNAVAILABLE');
  });
});
