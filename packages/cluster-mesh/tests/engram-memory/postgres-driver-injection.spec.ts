// Host PG driver injection (lot E7): the PG provider is required, its
// identity is checked, failed opens release resources and select no
// fallback, and positive installed driver calls run through the injected
// pool. Mirrors the sqlite-driver-injection contract for the PG substrate.

import { describe, expect, it } from 'vitest';
import { MemoryHostDriverRequiredError } from '../../src/engram-memory/sqlite.js';
import { checkMemoryPostgresDriver, createMemoryPostgresStorage } from '../../src/engram-memory/postgres.js';
import { StorageUnavailableError } from '../../src/storage/errors.js';
import { pgEnabled } from '../storage/pg-driver.js';
import { memoryAppend, memoryHostComposed, memoryPgHost, memoryUnit } from './pg-host.js';

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
});

describe.skipIf(!pgEnabled)('memory PG positive installed calls', () => {
  it('runs installed calls through the injected pool', async () => {
    const { binding } = memoryHostComposed();
    const host = await memoryPgHost();
    try {
      const root = await host.open();
      const bound = await root.bindNew(binding.maintainGrant);
      await bound.configureLifecycle('optional');
      const fence = {
        fenceId: 'host-fence', epoch: '1', incarnation: root.incarnation,
        ownerId: binding.maintainGrant.principalId,
      };
      await root.provisionFence(binding.maintainGrant, fence);
      await bound.commitAtomic(memoryUnit({ appends: [memoryAppend('7')] }));
      expect(await bound.readHead('memory-journal')).toBe('hash-7');
    } finally {
      await host.close();
    }
  });

  it('refuses storage composition without falling back, pool stays usable', async () => {
    const host = await memoryPgHost();
    try {
      await expect(createMemoryPostgresStorage(host.options)).rejects.toBeInstanceOf(StorageUnavailableError);
      const probe = await host.tx.run(true, (session) =>
        session.execute({ text: 'SELECT 1 AS one', values: [] }),
      );
      expect(probe.rows[0]).toMatchObject({ one: 1 });
    } finally {
      await host.close();
    }
  });
});
