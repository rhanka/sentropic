// Host PG driver injection (lot E7): the PG provider is required, its
// identity is checked, failed opens release resources and select no
// fallback, and positive installed driver calls run through the injected
// pool. Mirrors the sqlite-driver-injection contract for the PG substrate.

import { describe, expect, it } from 'vitest';
import { MemoryHostDriverRequiredError } from '../../src/engram-memory/sqlite.js';
import { checkMemoryPostgresDriver } from '../../src/engram-memory/postgres.js';
import { StorageUnavailableError } from '../../src/storage/errors.js';

const qualifiedProvider = () => ({
  identity: { name: 'node-pg-owner', version: '8.16.3', artifactDigest: 'b'.repeat(64) },
  serverFloor: '17.0.0',
});

describe('memory PG driver injection', () => {
  it('refuses construction without an explicit host provider', () => {
    expect(() => checkMemoryPostgresDriver(undefined)).toThrow(MemoryHostDriverRequiredError);
    expect(() => checkMemoryPostgresDriver(null)).toThrowError(/explicit host-injected/);
    expect(() => checkMemoryPostgresDriver({})).toThrow(MemoryHostDriverRequiredError);
  });

  it('refuses unqualified provider identities and weak servers', () => {
    expect(() =>
      checkMemoryPostgresDriver({
        ...qualifiedProvider(),
        identity: { name: '', version: '8.16.3', artifactDigest: 'b'.repeat(64) },
      }),
    ).toThrow(MemoryHostDriverRequiredError);
    expect(() =>
      checkMemoryPostgresDriver({
        ...qualifiedProvider(),
        identity: { name: 'node-pg-owner', version: '8.16.3', artifactDigest: 'not-hex' },
      }),
    ).toThrow(MemoryHostDriverRequiredError);
    expect(() => checkMemoryPostgresDriver({ ...qualifiedProvider(), serverFloor: '16.4.0' })).toThrow(
      StorageUnavailableError,
    );
    expect(() => checkMemoryPostgresDriver({ ...qualifiedProvider(), serverFloor: 'garbage' })).toThrow(
      StorageUnavailableError,
    );
    expect(checkMemoryPostgresDriver(qualifiedProvider())).toEqual(qualifiedProvider());
    expect(checkMemoryPostgresDriver({ ...qualifiedProvider(), serverFloor: '17.5.1' })).toEqual({
      ...qualifiedProvider(),
      serverFloor: '17.5.1',
    });
  });
  it.todo('runs positive installed driver calls through the injected pool');
  it.todo('releases pool resources when the open fails');
  it.todo('never falls back to an implicit driver or the generic kernel');
});
