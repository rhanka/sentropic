import { describe, expect, it } from 'vitest';
import { pgEnabled } from '../storage/pg-driver.js';
import { applyPgMigrations, verifyPgInstallation } from '../../src/storage/postgres/migrations.js';
import { createMemoryPostgresStorage } from '../../src/engram-memory/postgres.js';
import { memoryPgHost } from './pg-host.js';

describe.skipIf(!pgEnabled)('memory PostgreSQL registration', () => {
  it('should apply and verify memory history on the host session and reopen without new receipts', async () => {
    const host = await memoryPgHost();
    try {
      const assets = host.registration.assets;
      expect(assets.at(-1)).toMatchObject({ schemaRole: 'engram-memory', order: 2, fromVersion: 1, toVersion: 2 });
      await host.tx.run(false, async (session) => {
        const before = await host.history.read(session);
        await verifyPgInstallation(session, host.layout, assets, host.history);
        await applyPgMigrations(session, host.layout, assets, host.history, { id: 'again', checksum: 'b'.repeat(64) });
        expect(await host.history.read(session)).toEqual(before);
        expect(before.at(-1)?.id).toBe('cluster-mesh-pg/engram-memory/002-host-ledger@1');
      });
      await host.open();
      await host.open();
      await expect(createMemoryPostgresStorage(host.options)).rejects.toMatchObject({ code: 'unavailable' });
    } finally { await host.close(); }
  });

  it('should refuse memory schema drift and a missing projection role', async () => {
    const host = await memoryPgHost();
    try {
      await host.tx.run(false, (session) => session.execute({
        text: `ALTER TABLE "${host.name}_projection".memory_entries ADD COLUMN drift text`, values: [],
      }));
      await expect(host.open()).rejects.toThrow();
      await expect(host.tx.run(false, (session) => verifyPgInstallation(session,
        { ...host.layout, projectionSchemas: {} }, host.registration.assets, host.history))).rejects.toThrow();
    } finally { await host.close(); }
  });
});
