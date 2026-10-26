import { describe, expect, it } from 'vitest';
import { pgEnabled } from '../storage/pg-driver.js';
import { memoryAppend, memoryGrant, memoryPgHost, memoryUnit, memoryUpdate } from './pg-host.js';

const capture = { candidateId: 'c1', revision: 1, recordDigest: null, createdCursor: '1', proof: { content: 'first' } };
const outcome = { candidateId: 'c1', outcome: 'accepted', proof: { receipt: 'first' } };
const k7 = ['memory-capture-idempotency-v1', 'c1'];
const k8 = ['memory-admission-outcome-v1', 'c1'];

describe.skipIf(!pgEnabled)('transactional memory projection', () => {
  it('should complete K7 without appending and preserve K7/K8 across reopen and failed replacement', async () => {
    const host = await memoryPgHost();
    try {
      const bound = await (await host.open()).bindNew(memoryGrant());
      await bound.transact({}, async (tx) => {
        await tx.apply(memoryUnit({ updates: [memoryUpdate(k7, capture), memoryUpdate(k8, outcome)] }));
      });
      const completed = { ...capture, revision: 2, recordDigest: 'sha256:original' };
      const completion = await bound.commitAtomic(memoryUnit({ updates: [memoryUpdate(k7, completed, 2)] }));
      expect(completion.effectiveAppends).toBe(0);
      expect(await bound.readHead('memory-journal')).toBeNull();
      const reopened = await (await host.open()).bind(memoryGrant());
      await expect(reopened.commitAtomic(memoryUnit({ updates: [memoryUpdate(k7, { ...completed, proof: {} }, 3)] })))
        .rejects.toMatchObject({ code: 'invalid-command' });
      await expect(reopened.commitAtomic(memoryUnit({ updates: [memoryUpdate(k8, { ...outcome, outcome: 'rejected' }, 2)] })))
        .rejects.toMatchObject({ code: 'invalid-command' });
      expect(await reopened.readAggregate(JSON.stringify(k7))).toMatchObject({ value: { data: JSON.stringify(completed) } });
      expect(await reopened.readAggregate(JSON.stringify(k8))).toMatchObject({ value: { data: JSON.stringify(outcome) } });
    } finally { await host.close(); }
  });

  it('should validate against writes from the same transaction and roll back a caught inner refusal', async () => {
    const host = await memoryPgHost();
    try {
      const bound = await (await host.open()).bindNew(memoryGrant());
      await expect(bound.transact({}, async (tx) => {
        await tx.apply(memoryUnit({ updates: [memoryUpdate(k8, outcome)] }));
        await tx.apply(memoryUnit({ updates: [memoryUpdate(k8, { ...outcome, proof: {} }, 2)] })).catch(() => undefined);
      })).rejects.toThrow();
      expect(await bound.readAggregate(JSON.stringify(k8))).toBeNull();
      const count = await host.tx.run(true, (session) => session.execute({
        text: `SELECT count(*)::text AS count FROM "${host.name}_projection".memory_entries`, values: [],
      }));
      expect(count.rows[0]?.count).toBe('0');
      await expect(bound.commitAtomic(memoryUnit({
        appends: [memoryAppend('1')], updates: [memoryUpdate(k7, capture)],
      }))).rejects.toMatchObject({ code: 'invalid-command' });
      expect(await bound.readHead('memory-journal')).toBeNull();
    } finally { await host.close(); }
  });

  it('should reuse the original P3 commit receipt and refuse a different intent without projection writes', async () => {
    const host = await memoryPgHost();
    try {
      const bound = await (await host.open()).bindNew(memoryGrant());
      const unit = memoryUnit({ appends: [memoryAppend('1')], moduleResult: { first: true } });
      const receipt = await bound.commitAtomic(unit, { idempotencyKey: 'event-1' });
      expect(await bound.commitAtomic(unit, { idempotencyKey: 'event-1' })).toEqual(receipt);
      await expect(bound.commitAtomic(memoryUnit({ appends: [{ ...memoryAppend('2', 'hash-1'),
        record: { ...memoryAppend('2').record, id: 'event-1' },
      }] }))).rejects.toThrow();
      expect(await bound.query('memory-journal-page', { after: '0', limit: 10 }, { limit: 10 }))
        .toMatchObject({ records: [{ event_id: 'event-1', cursor: '1' }] });
    } finally { await host.close(); }
  });
});
