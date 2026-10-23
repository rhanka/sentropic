import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { pgEnabled, testPgDriver } from './pg-driver.js';
import { PgTransactions } from '../../src/storage/postgres/transactions.js';
describe.skipIf(!pgEnabled)('durable path-copy map', () => {
  const fixture = pgEnabled ? testPgDriver() : undefined;
  const schema = `map_${randomBytes(6).toString('hex')}`;
  afterAll(async () => {
    if (!fixture) return;
    await fixture.driver.transaction({ isolation: 'serializable', readOnly: false, deadlineMs: 2000 }, (session) => session.execute({ text: `DROP SCHEMA IF EXISTS "${schema}" CASCADE`, values: [] }));
    await fixture.close();
  });
  it('keeps old roots, lexical ranks and exact payload bytes without cloning a scope', async () => {
    const assets = await Promise.all(['001-core.sql', '002-map.sql'].map((name) => readFile(new URL(`../../assets/storage/postgres/${name}`, import.meta.url), 'utf8')));
    const tx = new PgTransactions(fixture!.driver);
    await tx.run(false, async (session) => {
      await session.execute({ text: `CREATE SCHEMA "${schema}"`, values: [] });
      for (const asset of assets) await session.execute({ text: asset.replaceAll('__DATA_SCHEMA__', `"${schema}"`), values: [] });
      let root: string | null = null;
      let saved: string | null = null;
      const expected = new Map<string, Buffer>();
      for (let n = 0; n < 257; n += 1) {
        const key = String((n * 71) % 257).padStart(4, '0');
        const value = Buffer.from(`\uFEFF🌍\u0000${key}`, 'utf8');
        const result = await session.execute({ text: `SELECT "${schema}".map_put($1::bigint, $2, $3) AS root`, values: [root, key, value] });
        root = String(result.rows[0]!.root); expected.set(key, value);
        if (n === 0) saved = root;
      }
      const before = await session.execute({ text: `SELECT count(*)::text AS total FROM "${schema}".map_nodes`, values: [] });
      root = String((await session.execute({ text: `SELECT "${schema}".map_put($1::bigint, $2, $3) AS root`, values: [root, '0000', Buffer.from('replacement')] })).rows[0]!.root);
      const after = await session.execute({ text: `SELECT count(*)::text AS total FROM "${schema}".map_nodes`, values: [] });
      expect(Number(after.rows[0]!.total) - Number(before.rows[0]!.total)).toBeLessThan(20);
      expect((await session.execute({ text: `SELECT "${schema}".map_get($1::bigint, $2) AS value`, values: [saved, '0000'] })).rows[0]!.value).toEqual(expected.get('0000'));
      const page = await session.execute({ text: `SELECT * FROM "${schema}".map_page($1::bigint, $2::bigint, $3::integer)`, values: [root, '254', 3] });
      expect(page.rows.map((row) => row.key)).toEqual(['0254', '0255', '0256']);
      expect(page.rows[2]!.value).toEqual(expected.get('0256'));
      const shape = await session.execute({ text: `SELECT height, size::text FROM "${schema}".map_nodes WHERE id=$1`, values: [root] });
      expect(shape.rows[0]!.size).toBe('257'); expect(Number(shape.rows[0]!.height)).toBeLessThan(12);
    });
  });
});
