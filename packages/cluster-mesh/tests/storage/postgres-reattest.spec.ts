import { describe, expect, it } from 'vitest';
import * as migrations from '../../src/storage/postgres/migrations.js';
import { createPgFixture } from './pg-fixture.js';
import { pgEnabled } from './pg-driver.js';

describe.skipIf(!pgEnabled)('operator schema re-attestation', () => {
  it('requires a known reference and previous fingerprint after catalog rendering changes', async () => {
    const f = await createPgFixture();
    const assets = await migrations.loadPgAssets();
    try {
      const receipts = await f.tx.run(true, (s) => f.options.history.read(s));
      const referenceFingerprint = receipts.at(-1)!.schemaFingerprint;
      // Simulate a receipt made before a PostgreSQL catalog-rendering change.
      await f.tx.run(false, (s) => s.execute({
        text: `UPDATE "${f.name}".host_history SET receipt=jsonb_set(receipt,'{schemaFingerprint}',to_jsonb($1::text)) WHERE ordinal=6`,
        values: ['0'.repeat(64)],
      }));
      await expect(f.open()).rejects.toMatchObject({ condition: 'schema-drift' });
      let attested = 0;
      const history = { ...f.options.history, reattest: async (s, attestation) => {
        attested++;
        await s.execute({
          text: `UPDATE "${f.name}".host_history SET receipt=jsonb_set(receipt,'{schemaFingerprint}',to_jsonb($1::text)) WHERE ordinal=6`,
          values: [attestation.schemaFingerprint],
        });
      } } satisfies migrations.PgHostHistory;
      const approval = {
        previousFingerprint: '0'.repeat(64), referenceFingerprint,
        hostMigrationId: 'pg-major-upgrade/18', hostChecksum: 'b'.repeat(64), reason: 'Compared clean reference DDL on target PostgreSQL',
      };
      await expect(f.tx.run(false, (s) => migrations.reattestPgInstallation(s, f.options.layout, assets, history,
        { ...approval, previousFingerprint: '1'.repeat(64) }))).rejects.toMatchObject({ condition: 'configuration' });
      expect(attested).toBe(0);
      await f.tx.run(false, (s) => migrations.reattestPgInstallation(s, f.options.layout, assets, history, approval));
      expect(attested).toBe(1);
      await f.open();
      // Host migrations need verification, but unrelated DDL needs no new receipt.
      await f.tx.run(false, (s) => s.execute({ text: `CREATE TABLE "${f.name}".host_after_upgrade(id text)`, values: [] }));
      await f.open();
      await f.tx.run(false, (s) => s.execute({ text: `ALTER TABLE "${f.name}".payloads ADD COLUMN unauthorized text`, values: [] }));
      await expect(f.tx.run(false, (s) => migrations.reattestPgInstallation(s, f.options.layout, assets, history,
        { ...approval, previousFingerprint: referenceFingerprint }))).rejects.toMatchObject({ condition: 'schema-drift' });
      expect(attested).toBe(1);
    } finally { await f.close(); }
  });
});
