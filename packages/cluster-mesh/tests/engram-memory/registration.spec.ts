// G1a registration: module admission, descriptor validity, fixed Postgres
// registration shape and explicit refusal paths. No live backend is
// required: every case runs against installed code only.

import { describe, expect, it } from 'vitest';
import { isStorageModuleId, type StorageModuleId } from '../../src/storage/contracts.js';
import { validateScopeGrant } from '../../src/storage/authority.js';
import { validateModuleDescriptor } from '../../src/storage/descriptor.js';
import { MEMORY_CONTRACT_DIGEST, MEMORY_DESCRIPTOR, MEMORY_MODULE_ID } from '../../src/engram-memory/manifest.js';
import {
  createMemoryPostgresRegistration,
  createMemoryPostgresStorage,
  validateMemoryEffects,
} from '../../src/engram-memory/postgres.js';
import { StorageUnavailableError } from '../../src/storage/errors.js';
import { MEMORY_STORAGE_LIMITS, requireMemoryStorageLimits } from '../../src/engram-memory/limits.js';
import type { AtomicUnit } from '../../src/storage/atomic.js';

const emptyUnit = (): AtomicUnit =>
  ({
    guards: [],
    records: [],
    appends: [],
    updates: [],
    relationships: [],
    barriers: [],
    purgeIntents: [],
    indexWrites: [],
  }) as AtomicUnit;

const captureUpdate = (value: unknown) => ({
  key: JSON.stringify(['memory-capture-idempotency-v1', 'candidate-1']),
  version: 1,
  value: { format: 'utf8', data: JSON.stringify(value) },
});

const memoryGrant = (moduleId: string) => ({
  token: 'token-1',
  moduleId,
  scope: { tenantId: 'tenant-1', workspaceId: 'workspace-1' },
  principalId: 'principal-1',
  operations: ['read', 'write'],
  issuer: 'issuer-1',
  authorityRevision: '1',
  policyRevision: '1',
  moduleAuthority: {},
  lifetime: { kind: 'invocation', invocationId: 'invocation-1' },
});

describe('memory module admission', () => {
  it('should admit engram-memory as a distinct module, never aliased to engram-live', () => {
    expect(MEMORY_MODULE_ID).toBe('engram-memory');
    expect(isStorageModuleId('engram-memory')).toBe(true);
    expect(isStorageModuleId('engram-live')).toBe(true);
    expect(isStorageModuleId('comments')).toBe(true);
    expect(isStorageModuleId('unknown-module')).toBe(false);
  });

  it('should admit memory scope grants and refuse module mismatch', () => {
    expect(validateScopeGrant(memoryGrant('engram-memory'), { expectedModuleId: 'engram-memory' }).ok).toBe(true);
    expect(
      validateScopeGrant(memoryGrant('engram-live'), { expectedModuleId: 'engram-memory' as StorageModuleId }).ok,
    ).toBe(false);
    expect(validateScopeGrant(memoryGrant('unknown'), {}).ok).toBe(false);
  });

  it('should import without activating anything', async () => {
    const contract = await import('../../src/engram-memory/contract.js');
    expect(contract.MEMORY_MODULE_ID).toBe('engram-memory');
    expect(Object.isFrozen(contract.MEMORY_DESCRIPTOR)).toBe(true);
    expect(Object.isFrozen(contract.MEMORY_STORAGE_LIMITS)).toBe(true);
    expect(Object.isFrozen(contract.MEMORY_PINNED_PROFILES)).toBe(true);
    expect(typeof contract.createMemoryPostgresRegistration).toBe('function');
    expect(typeof contract.createMemorySqliteStorage).toBe('function');
  });

  it('should carry a valid descriptor with the pinned digest and five queries', () => {
    expect(validateModuleDescriptor(MEMORY_DESCRIPTOR).ok).toBe(true);
    expect(MEMORY_DESCRIPTOR.contractVersion).toBe('memory-binding-v1');
    expect(MEMORY_DESCRIPTOR.contractDigest).toBe(MEMORY_CONTRACT_DIGEST);
    expect([...MEMORY_DESCRIPTOR.queryNames]).toEqual([
      'memory-journal-page',
      'memory-record-by-id',
      'memory-accepted-snapshot',
      'memory-outbox-page',
      'scope-chain-index',
    ]);
    expect(MEMORY_DESCRIPTOR.pageLimits).toEqual({ maxRecords: 2000, maxEncodedBytes: 1048576 });
  });
});

describe('memory Postgres registration', () => {
  it('should return fixed descriptor, five queries, limits and core assets', async () => {
    const registration = await createMemoryPostgresRegistration();
    expect(registration.descriptor.contractDigest).toBe(MEMORY_CONTRACT_DIGEST);
    expect(Object.keys(registration.queries).sort()).toEqual([...MEMORY_DESCRIPTOR.queryNames].sort());
    expect(registration.limits).toEqual(MEMORY_STORAGE_LIMITS);
    expect(registration.assets.length).toBeGreaterThan(0);
  });

  it('should accept well-formed capture creation and refuse malformed proofs', async () => {
    await validateMemoryEffects({
      ...emptyUnit(),
      updates: [
        captureUpdate({ candidateId: 'candidate-1', revision: 1, recordDigest: null, createdCursor: '0', proof: {} }),
      ],
    });
    await expect(
      validateMemoryEffects({ ...emptyUnit(), updates: [captureUpdate({ candidateId: 'candidate-1' })] }),
    ).rejects.toThrow();
    await expect(validateMemoryEffects({ ...emptyUnit(), updates: [{ ...captureUpdate({}), key: 'plain' }] })).rejects.toThrow();
  });

  it('should refuse capture completion units carrying appends', async () => {
    const completion = captureUpdate({
      candidateId: 'candidate-1',
      revision: 2,
      recordDigest: 'sha256:abc',
      createdCursor: '0',
      proof: {},
    });
    await expect(
      validateMemoryEffects({
        ...emptyUnit(),
        appends: [{ chainId: 'memory-journal', record: { id: 'e1', bytes: '{}', hash: 'sha256:abc' } }],
        updates: [completion],
      }),
    ).rejects.toThrow();
  });

  it('should keep installed limits fixed against weaker host limits', () => {
    expect(requireMemoryStorageLimits()).toEqual(MEMORY_STORAGE_LIMITS);
    expect(() => requireMemoryStorageLimits({ maxRecords: 1, maxAppends: 1, maxEncodedBytes: 1 })).toThrow();
  });

  it('should fail closed at Postgres composition until the G1b stateful projection is wired', async () => {
    await expect(createMemoryPostgresStorage({} as never)).rejects.toThrowError(StorageUnavailableError);
    await expect(createMemoryPostgresStorage({} as never)).rejects.toThrow(/G1b/);
  });
});
