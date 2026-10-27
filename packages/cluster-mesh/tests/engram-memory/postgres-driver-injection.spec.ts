// Host PG driver injection (lot E7): the PG provider is required, its
// identity is checked, failed opens release resources and select no
// fallback, and positive installed driver calls run through the injected
// pool. Mirrors the sqlite-driver-injection contract for the PG substrate.

import { describe, expect, it } from 'vitest';
import { MemoryHostDriverRequiredError } from '../../src/engram-memory/sqlite.js';
import { checkMemoryPostgresDriver, createMemoryPostgresStorage } from '../../src/engram-memory/postgres.js';
import { openMemoryMaintenance } from '../../src/engram-memory/host-maintenance.js';
import { StorageDeniedError, StorageUnavailableError } from '../../src/storage/errors.js';
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
  it('runs the write path on the neutral grant and maintenance on the maintain grant', async () => {
    const { binding } = memoryHostComposed();
    const host = await memoryPgHost();
    try {
      const root = await host.open();
      // Write path (neutral grant only): provision, commit, read. No
      // lifecycle configuration: that is a maintain-gated operation.
      const bound = await root.bindNew(binding.memoryGrant);
      const fence = {
        fenceId: 'host-fence', epoch: '1', incarnation: root.incarnation,
        ownerId: binding.memoryGrant.principalId,
      };
      await root.provisionFence(binding.memoryGrant, fence);
      await bound.commitAtomic(memoryUnit({ appends: [memoryAppend('7')] }));
      expect(await bound.readHead('memory-journal')).toBe('hash-7');
      // Maintenance path (maintain grant only): the host configures
      // lifecycle, then fence check and checkpoint run through the
      // host-only ports. Poison/retry/resync/snapshot stay kernel-coupled
      // (consumer reads need read+maintain): ports delegate, live use
      // waits on the G1b composition, kernel unchanged per E7 scope.
      // Note: lifecycle configuration runs through runPgTransaction, whose
      // entry check requires write, so it stays outside the strict split
      // (E6 combined-grant coverage owns it).
      const boundM = await root.bindNew(binding.maintainGrant);
      const ports = openMemoryMaintenance(binding, {
        grant: binding.maintainGrant,
        currentFence: () => boundM.journalFence(),
        checkpoint: (consumer, expected, next, check) =>
          boundM.journalCheckpoint(consumer, expected, next, check),
        poison: (consumer, event, reason) => boundM.journalPoison(consumer, event, reason),
        retry: (consumer, expected, check) => boundM.journalRetry(consumer, expected, check),
        resync: (consumer, check) => boundM.journalResync(consumer, check),
        snapshot: (token, after, limit) => boundM.snapshotRead(token, after, limit),
      });
      const current = await boundM.journalFence();
      expect(await ports.checkFence(current)).toEqual(current);
      await expect(ports.checkFence({ ...current, epoch: '999' })).rejects.toThrow(
        /not current/,
      );
      await ports.checkpoint('host-consumer', '0', '0', current);
      // The neutral handle cannot reach maintain authority at the kernel.
      await expect(bound.journalCheckpoint('host-consumer', '0', '0', current)).rejects.toThrow(
        StorageDeniedError,
      );
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
