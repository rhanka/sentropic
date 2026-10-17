import { describe, expect, it } from 'vitest';
import { createPgFixture } from './pg-fixture.js';
import { pgEnabled } from './pg-driver.js';
import { grantFor } from './authority-corpus.js';
import { emptyEffects } from '../../src/storage/staged-preparation.js';
describe.skipIf(!pgEnabled)('cumulative Postgres transaction admission', () => {
  it('bounds immutable record writes across sequential applies and rolls the entire callback back', async () => {
    const fixture = await createPgFixture();
    try {
      const bound = await (await fixture.open()).bindNew(grantFor());
      await expect(bound.transact({ limits: { maxRecords: 2, maxAppends: 2, maxEncodedBytes: 524288 } }, async (tx) => {
        for (let i = 0; i < 3; i++) await tx.apply({ ...emptyEffects(), records: [{ key: `bounded-${i}`, contentHash: 'h', bytes: { format: 'utf8', data: 'bounded' } }] });
      })).rejects.toMatchObject({ code: 'invalid-command' });
      expect(await bound.readRecord('bounded-0')).toBeNull();
    } finally { await fixture.close(); }
  });
});
