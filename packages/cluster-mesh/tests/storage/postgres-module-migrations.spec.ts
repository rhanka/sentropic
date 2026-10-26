import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { applyPgMigrations, loadPgAssets, verifyPgInstallation, type PgAsset } from '../../src/storage/postgres/migrations.js';
import { createPgFixture } from './pg-fixture.js';
import { pgEnabled } from './pg-driver.js';
import { createPostgresKernel } from '../../src/storage/postgres/index.js';

describe.skipIf(!pgEnabled)('independent module migration chains', () => {
  it('installs comments once and appends core 009 without renumbering comments receipts', async () => {
    const assets = await loadPgAssets({ comments: true });
    const comments = assets.filter((asset) => asset.schemaRole === 'comments');
    expect(comments.map((asset) => asset.order)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(comments[0].requires).toEqual(['cluster-mesh-pg/006-staged-coverage@1']);
    const f = await createPgFixture({ assets });
    try {
      const before = await f.tx.run(true, (s) => f.options.history.read(s));
      const sql = 'CREATE TABLE __DATA_SCHEMA__.future_core(id text PRIMARY KEY);';
      const next: PgAsset = {
        id: 'cluster-mesh-pg/009-future@1', file: '009-future.sql', order: 9,
        fromVersion: 8, toVersion: 9, requires: ['cluster-mesh-pg/008-instance-ownership@1'],
        dialect: 'postgresql', mode: 'transactional', sql,
        checksum: createHash('sha256').update(sql).digest('hex'),
      };
      const upgraded = [...assets.filter((asset) => !asset.schemaRole), next, ...comments];
      await f.tx.run(false, (s) => applyPgMigrations(s, f.options.layout, upgraded, f.options.history,
        { id: 'host/core-007', checksum: 'c'.repeat(64) }));
      await f.tx.run(true, (s) => verifyPgInstallation(s, f.options.layout, upgraded, f.options.history));
      const after = await f.tx.run(true, (s) => f.options.history.read(s));
      expect(after).toHaveLength(15);
      expect(after.filter((row) => row.schemaRole === 'comments')).toEqual(before.filter((row) => row.schemaRole === 'comments'));
      expect(after.at(-1)?.id).toBe(next.id);
      await createPostgresKernel({ ...f.options, assets: upgraded });
    } finally { await f.close(); }
  });
});
