// G1 binding errors: every failure across the host seam stays typed —
// missing or weak drivers refuse at the host boundary, S-gated storage
// refuses through the substrate, and nothing ever falls back.

import { describe, expect, it } from 'vitest';
import { openModuleStorageCanonicalMemoryStoreV1 } from '@sentropic/engram/memory-substrate';
import { MemoryHostDriverRequiredError } from '../../src/engram-memory/sqlite.js';
import { StorageUnavailableError } from '../../src/storage/errors.js';
import {
  G1_STORE_ID,
  g1Clock,
  g1Deadline,
  g1Grant,
  g1HostHandle,
  g1ScopeBinding,
  openG1MemoryStore,
} from './g1-host.js';
import type { MemorySqliteDriverProvider } from '../../src/engram-memory/sqlite.js';

const qualifiedDriver = (): MemorySqliteDriverProvider => ({
  identity: { name: 'g1-host-sqlite-owner', version: '1', artifactDigest: 'e'.repeat(64) },
  engineFloor: '3.51.3',
});

describe('G1 binding errors stay typed', () => {
  it('should refuse a missing host driver before reaching the substrate', async () => {
    await expect(openG1MemoryStore(undefined)).rejects.toBeInstanceOf(MemoryHostDriverRequiredError);
    await expect(openG1MemoryStore(null)).rejects.toMatchObject({ code: 'HOST_DRIVER_REQUIRED' });
    await expect(openG1MemoryStore({})).rejects.toBeInstanceOf(MemoryHostDriverRequiredError);
  });

  it('should refuse a driver identity without a named versioned artifact digest', async () => {
    const noName = { ...qualifiedDriver(), identity: { name: '', version: '1', artifactDigest: 'e'.repeat(64) } };
    await expect(openG1MemoryStore(noName)).rejects.toBeInstanceOf(MemoryHostDriverRequiredError);
    const noDigest = {
      ...qualifiedDriver(),
      identity: { name: 'g1-host-sqlite-owner', version: '1', artifactDigest: 'not-hex' },
    };
    await expect(openG1MemoryStore(noDigest)).rejects.toMatchObject({ code: 'HOST_DRIVER_REQUIRED' });
  });

  it('should refuse a driver engine below the qualified floor', async () => {
    const weak = { ...qualifiedDriver(), engineFloor: '3.44.6' };
    await expect(openG1MemoryStore(weak)).rejects.toBeInstanceOf(StorageUnavailableError);
    await expect(openG1MemoryStore(weak)).rejects.toMatchObject({ code: 'unavailable' });
  });

  it('should surface S-gated storage as a typed unavailable result without fallback', async () => {
    const result = await openG1MemoryStore(qualifiedDriver());
    expect(result.ok).toBe(false);
    expect(result.error).toEqual({
      code: 'STORE_UNAVAILABLE',
      operation: 'admin',
      message: expect.stringContaining('G1d provider seam') as unknown as string,
      retryable: false,
    });
  });

  it('should never select an implicit driver or the generic kernel', async () => {
    const handle = g1HostHandle();
    expect(handle.moduleId).toBe('engram-memory');
    expect(handle.backend).toBe('sqlite');
    expect(G1_STORE_ID).toBe('g1-qualification-canonical-store-01');
    // A handle without acquireFence is not a neutral port at all.
    const { acquireFence: _dropped, ...withoutFence } = handle as unknown as Record<string, unknown>;
    void _dropped;
    const result = (await openModuleStorageCanonicalMemoryStoreV1({
      handle: withoutFence,
      scope_binding: g1ScopeBinding(),
      grant: g1Grant(),
      clock: g1Clock(),
      deadline_at: g1Deadline(),
    })) as unknown as { ok: boolean; error?: { code?: unknown } };
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('CAPABILITY_UNAVAILABLE');
  });
});
