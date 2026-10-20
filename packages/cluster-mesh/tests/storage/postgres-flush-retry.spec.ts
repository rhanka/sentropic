import { describe, expect, it } from 'vitest';
import { createPgFixture } from './pg-fixture.js';
import { pgEnabled } from './pg-driver.js';
import { grantFor } from './authority-corpus.js';
import { createPostgresKernel } from '../../src/storage/postgres/index.js';
import { emptyEffects } from '../../src/storage/staged-preparation.js';
import type { InjectedPgDriver } from '../../src/storage/postgres/protocol.js';
describe.skipIf(!pgEnabled)('immutable flush retry on the real driver', () => {
  it('retries a frozen atomic plan after rollback and never reruns a user callback', async () => {
    const fixture = await createPgFixture();
    try {
      let failures = 0; let attempts = 0;
      const driver: InjectedPgDriver = { transaction: (options, operation) => fixture.options.driver.transaction(options, async (session) => {
        let publishing = false;
        const result = await operation({ execute: (statement) => {
          if (statement.text.startsWith('UPDATE') && statement.text.includes('.scopes ')) publishing = true;
          return session.execute(statement);
        } });
        if (publishing) { attempts += 1; if (failures > 0) { failures -= 1; throw { code: '40001' }; } }
        return result;
      }) };
      const root = await createPostgresKernel({ ...fixture.options, driver }); const grant = grantFor({ operations: ['read', 'write', 'maintain'] }); const bound = await root.bindNew(grant);
      const unit = (key: string) => ({ ...emptyEffects(), records: [{ key, contentHash: key, bytes: { format: 'utf8' as const, data: key } }] });
      failures = 1;
      const receipt = await bound.commitAtomic(unit('immutable'), { idempotencyKey: 'immutable-plan' });
      expect(attempts).toBe(2); expect(receipt.effectiveRecords).toBe(1);
      expect((await bound.journalRead(0, 10)).events).toHaveLength(1);
      failures = 1; attempts = 0; let callbackRuns = 0;
      await expect(bound.transact({}, async (tx) => { callbackRuns += 1; await tx.apply(unit('user')); })).rejects.toMatchObject({ condition: 'contention' });
      expect(callbackRuns).toBe(1); expect(attempts).toBe(1); expect(await bound.readRecord('user')).toBeNull();
    } finally { await fixture.close(); }
  });
});
