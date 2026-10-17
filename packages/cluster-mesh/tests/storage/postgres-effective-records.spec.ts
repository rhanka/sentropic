import { describe, expect, it } from 'vitest';
import { createPgFixture } from './pg-fixture.js';
import { pgEnabled } from './pg-driver.js';
import { grantFor } from './authority-corpus.js';
import { emptyEffects } from '../../src/storage/staged-preparation.js';
import { createPostgresKernel } from '../../src/storage/postgres/index.js';

describe.skipIf(!pgEnabled)('durable Postgres effective records', () => {
  it('should reject an absent cursor key before opening durable storage', async () => {
    const f = await createPgFixture();
    try {
      await expect(createPostgresKernel({ ...f.options, cursorSecret: undefined! }))
        .rejects.toMatchObject({ code: 'invalid-command' });
      await expect(createPostgresKernel({ ...f.options, cursorSecret: '' }))
        .rejects.toMatchObject({ code: 'invalid-command' });
    } finally { await f.close(); }
  });

  it('should project immutable creations once while validating every raw plan', async () => {
    const projected: string[][] = [];
    const validated: string[][] = [];
    const f = await createPgFixture({
      projection: async (effects) => { projected.push(effects.records.map((r) => r.key)); },
      validateEffects: async (effects) => { validated.push(effects.records.map((r) => r.key)); },
    });
    try {
      const root = await f.open();
      const bound = await root.bindNew(grantFor());
      const record = { key: 'immutable', contentHash: 'h', bytes: { format: 'utf8' as const, data: 'original' } };
      const unit = { ...emptyEffects(), records: [record] };
      expect((await bound.commitAtomic(unit)).effectiveRecords).toBe(1);
      expect((await bound.commitAtomic(unit)).effectiveRecords).toBe(0);
      expect(projected).toEqual([['immutable'], []]);
      expect(validated).toEqual([['immutable'], ['immutable']]);
      await expect(bound.commitAtomic({ ...unit, records: [{ ...record, bytes: { ...record.bytes, data: 'changed' } }] }))
        .rejects.toMatchObject({ code: 'idempotency-conflict' });
      expect(projected).toHaveLength(2);
    } finally { await f.close(); }
  });
});
