// E2 migration chain for consumed counters/versions: the published 001-006
// assets stay byte-identical, 007 widens semantic counter columns to exact
// NUMERIC(20) bounded to the u64 range, and legacy rows keep working.
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  applyPgMigrations,
  loadPgAssets,
  verifyPgInstallation,
  type PgHostHistory,
} from '../../src/storage/postgres/migrations.js';
import { PgTransactions } from '../../src/storage/postgres/transactions.js';
import { pgEnabled, testPgDriver } from './pg-driver.js';
import { createPgFixture } from './pg-fixture.js';
import { grantFor } from './authority-corpus.js';

const FROZEN_DATA_ASSETS = [
  ['cluster-mesh-pg/001-core@1', '001-core.sql', 1, 0, 1, '40fa2bed5b4076860d505385f3e044bc60e74a2e1e1bfd524562cd911812c460'],
  ['cluster-mesh-pg/002-map@1', '002-map.sql', 2, 1, 2, '03a9c68bfb1ace1eb3c067a04d2293129f80d4cb354f28a22298bf66354b1dfc'],
  ['cluster-mesh-pg/003-staged@1', '003-staged.sql', 3, 2, 3, '1d1c6bd83bb080ecde057181742554fddd2812f08d03ea16407bf3a77ba429d5'],
  ['cluster-mesh-pg/004-queries@1', '004-queries.sql', 4, 3, 4, '17a5c4a78e20efa1c9a21f0112b5cbf70b9f9acaf8d577f2e16efc6759e4b295'],
  ['cluster-mesh-pg/005-cleanup@1', '005-cleanup.sql', 5, 4, 5, 'f8fda33a8f9c167f53be412977418da063c1e14c0ed7f3d8a96a9feeba01fa5f'],
  ['cluster-mesh-pg/006-staged-coverage@1', '006-staged-coverage.sql', 6, 5, 6, '82b4f485399fd195eaf5178144e23f6d6b26dd36010d78b05816b8e96079d75f'],
] as const;

describe('consumed-counter migration chain', () => {
  it('keeps published 001-006 assets byte-identical and chains 007 exactly', async () => {
    const assets = await loadPgAssets();
    expect(assets).toHaveLength(7);
    for (const [id, file, order, fromVersion, toVersion, checksum] of FROZEN_DATA_ASSETS) {
      const asset = assets.find((candidate) => candidate.id === id);
      expect(asset, id).toBeDefined();
      expect(asset!.file).toBe(file);
      expect(asset!.order).toBe(order);
      expect(asset!.fromVersion).toBe(fromVersion);
      expect(asset!.toVersion).toBe(toVersion);
      expect(asset!.requires).toEqual(order === 1 ? [] : [assets[order - 2]!.id]);
      expect(asset!.checksum).toBe(checksum);
      expect(asset!.dialect).toBe('postgresql');
      expect(asset!.mode).toBe('transactional');
    }
    const seventh = assets[6]!;
    expect(seventh.id).toBe('cluster-mesh-pg/007-consumed-counters@1');
    expect(seventh.file).toBe('007-consumed-counters.sql');
    expect(seventh.order).toBe(7);
    expect(seventh.fromVersion).toBe(6);
    expect(seventh.toVersion).toBe(7);
    expect(seventh.requires).toEqual(['cluster-mesh-pg/006-staged-coverage@1']);
    expect(seventh.dialect).toBe('postgresql');
    expect(seventh.mode).toBe('transactional');
    expect(seventh.sql).toContain('NUMERIC(20)');
    expect(seventh.sql).toContain('18446744073709551615');
  });
});

describe.skipIf(!pgEnabled)('consumed-counter migration application', () => {
  const historyFor = (name: string): PgHostHistory => ({
    read: async (session) => (await session.execute({ text: `SELECT receipt FROM "${name}".host_history ORDER BY ordinal`, values: [] })).rows.map((row) => row.receipt),
    complete: async (session, receipt) => { await session.execute({ text: `INSERT INTO "${name}".host_history(ordinal,receipt) VALUES($1,$2::jsonb)`, values: [receipt.order, JSON.stringify(receipt)] }); },
  });
  it('applies 007 idempotently and exposes numeric u64 counter columns', async () => {
    const fixture = testPgDriver();
    const name = `u64mig_${randomBytes(6).toString('hex')}`;
    const layout = { dataSchema: name, projectionSchemas: {}, outboxSchema: name };
    try {
      const tx = new PgTransactions(fixture.driver);
      const assets = await loadPgAssets();
      await tx.run(false, async (session) => {
        await session.execute({ text: `CREATE SCHEMA "${name}"; CREATE TABLE "${name}".host_history(ordinal integer PRIMARY KEY,receipt jsonb NOT NULL)`, values: [] });
        await applyPgMigrations(session, layout, assets, historyFor(name), { id: 'neutral-host/007', checksum: 'b'.repeat(64) });
      });
      const columns = await tx.run(true, (session) => session.execute({
        text: `SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema=$1 AND ((table_name='scopes' AND column_name IN ('version','sequence')) OR (table_name='fences' AND column_name='epoch') OR (table_name='journal' AND column_name='sequence') OR (table_name='boundaries' AND column_name IN ('version','sequence')))`,
        values: [name],
      }));
      expect(columns.rows).toHaveLength(7);
      for (const row of columns.rows) expect(row.data_type).toBe('numeric');
      const checks = await tx.run(true, (session) => session.execute({
        text: `SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid IN (to_regclass($1), to_regclass($2), to_regclass($3), to_regclass($4)) AND conname LIKE '%_u64'`,
        values: [`"${name}".scopes`, `"${name}".fences`, `"${name}".journal`, `"${name}".boundaries`],
      }));
      const names = checks.rows.map((row) => row.conname).sort();
      expect(names).toEqual(['boundaries_sequence_u64', 'boundaries_version_u64', 'fences_epoch_u64', 'journal_sequence_u64', 'scopes_sequence_u64', 'scopes_version_u64']);
      for (const row of checks.rows) expect(row.def).toContain('18446744073709551615');
      await tx.run(false, (session) => applyPgMigrations(session, layout, assets, historyFor(name), { id: 'neutral-host/007', checksum: 'b'.repeat(64) }));
      const receipts = await tx.run(true, (session) => session.execute({ text: `SELECT COUNT(*)::text AS n FROM "${name}".host_history`, values: [] }));
      expect(receipts.rows[0]!.n).toBe('7');
      await tx.run(true, (session) => verifyPgInstallation(session, layout, assets, historyFor(name)));
    } finally {
      await txRun(fixture, name);
    }
  });
  it('keeps legacy rows working through the widened counters', async () => {
    const fixture = await createPgFixture();
    try {
      const root = await fixture.open();
      const bound = await root.bindNew(grantFor({ operations: ['read', 'write'] }));
      expect(await readCounters(fixture)).toEqual({ version: '0', sequence: '0' });
      await bound.commitAtomic({ guards: [], records: [{ key: 'legacy', contentHash: 'h', bytes: { format: 'utf8', data: 'v' } }], appends: [], updates: [], relationships: [], barriers: [], purgeIntents: [], indexWrites: [] });
      expect(await readCounters(fixture)).toEqual({ version: '1', sequence: '1' });
    } finally { await fixture.close(); }
  });
});

const txRun = async (fixture: { tx: PgTransactions; close(): Promise<void> }, name: string) => {
  await fixture.tx.run(false, (session) => session.execute({ text: `DROP SCHEMA IF EXISTS "${name}" CASCADE`, values: [] }));
  await fixture.close();
};

const readCounters = async (fixture: { tx: PgTransactions; name: string }) => {
  const result = await fixture.tx.run(true, (session) => session.execute({
    text: `SELECT version::text AS version, sequence::text AS sequence FROM "${fixture.name}".scopes`,
    values: [],
  }));
  return result.rows[0] as { version: string; sequence: string };
};
