// G1a host SQLite driver injection: the provider is required, its identity
// is checked, failed opens release resources and select no fallback, and
// composition refuses while durable profiles are unavailable.

import { describe, expect, it } from 'vitest';
import { SQLITE_MIN_ENGINE } from '../../src/storage/sqlite/engine.js';
import {
  MEMORY_SQLITE_ENGINE_FLOOR,
  MEMORY_SQLITE_QUALIFICATION,
  MemoryHostDriverRequiredError,
  checkMemorySqliteDriver,
  createMemorySqliteRegistration,
  createMemorySqliteStorage,
  type MemorySqliteDriverProvider,
} from '../../src/engram-memory/sqlite.js';
import { MEMORY_DESCRIPTOR, MEMORY_REQUIRED_PROFILES } from '../../src/engram-memory/manifest.js';
import { memorySqliteQuery } from '../../src/engram-memory/sqlite-queries.js';

const qualifiedProvider = (): MemorySqliteDriverProvider => ({
  identity: { name: 'node-sqlite-owner', version: '1', artifactDigest: 'a'.repeat(64) },
  engineFloor: '3.51.3',
});

describe('memory SQLite driver injection', () => {
  it('should refuse construction without an explicit host provider', async () => {
    await expect(
      createMemorySqliteStorage({ path: '/tmp/memory.db', driver: undefined as never }),
    ).rejects.toBeInstanceOf(MemoryHostDriverRequiredError);
    await expect(
      createMemorySqliteStorage({ path: '/tmp/memory.db', driver: null as never }),
    ).rejects.toMatchObject({ code: 'HOST_DRIVER_REQUIRED' });
  });

  it('should refuse unqualified provider identities and weak engines', () => {
    expect(() =>
      checkMemorySqliteDriver({ identity: { name: '', version: '1', artifactDigest: 'a'.repeat(64) }, engineFloor: '3.51.3' }),
    ).toThrow(MemoryHostDriverRequiredError);
    expect(() =>
      checkMemorySqliteDriver({ identity: { name: 'x', version: '1', artifactDigest: 'not-hex' }, engineFloor: '3.51.3' }),
    ).toThrow(MemoryHostDriverRequiredError);
    expect(() => checkMemorySqliteDriver({ ...qualifiedProvider(), engineFloor: '3.44.6' })).toThrow();
    expect(checkMemorySqliteDriver(qualifiedProvider())).toEqual(qualifiedProvider());
  });

  it('should refuse composition with a qualified provider until G1d wires the seam', async () => {
    await expect(createMemorySqliteStorage({ path: '/tmp/memory.db', driver: qualifiedProvider() })).rejects.toMatchObject({
      code: 'unavailable',
    });
  });

  it('should never fall back to an implicit driver or the generic kernel', async () => {
    const registration = await createMemorySqliteRegistration();
    expect(registration.descriptor).toBe(MEMORY_DESCRIPTOR);
    expect(Object.keys(registration.queries)).toHaveLength(5);
    expect(registration.qualification.isolation).toBe('process');
    expect(registration.qualification.requiredProfiles.map((entry) => entry.profile)).toEqual([
      ...MEMORY_REQUIRED_PROFILES,
    ]);
    for (const entry of registration.qualification.requiredProfiles) {
      expect(entry.status).toBe('pending-qualification');
    }
  });

  it('should validate SQLite query inputs before refusing unavailable tables', async () => {
    await expect(memorySqliteQuery('memory-journal-page')({ after: 'nope', limit: 10 }, 2000)).rejects.toMatchObject({
      code: 'invalid-command',
    });
    await expect(memorySqliteQuery('memory-record-by-id')({ record_id: 'r1' }, 2000)).rejects.toMatchObject({
      code: 'unavailable',
    });
  });

  it('should pin the engine floor to the installed SQLite engine constant', () => {
    expect(MEMORY_SQLITE_ENGINE_FLOOR).toBe(SQLITE_MIN_ENGINE);
    expect(MEMORY_SQLITE_QUALIFICATION).toMatchObject({
      engineFloor: '3.51.3',
      journalMode: 'WAL',
      synchronous: 'FULL',
      lockingMode: 'EXCLUSIVE',
    });
  });
});
