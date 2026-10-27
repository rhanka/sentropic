import { expect, it } from 'vitest';
import { PgRoots } from '../../src/storage/postgres/roots.js';
import { memoryJcs } from '../../src/engram-memory/codec.js';
import type { NeutralAtomicUnit, NeutralCommitOptions } from '../../src/engram-memory/neutral-contract.js';
import type { MemoryCampaignHost } from './memory-pg-host.js';
import { DIGEST, hostReceiptDigest, NOW } from './memory-engine.js';

const MAX = '18446744073709551615';
export const runMemoryU64Corpus = (open: () => Promise<MemoryCampaignHost>) => {
  for (const previous of ['9007199254740991', '9223372036854775807', '18446744073709551614']) {
    it(`atomic-units-v1/C5/${previous}: should cross with exact K3 K5 K8 guards chain positions and publication counters`, async () => {
      const h = await open();
      try {
        const next = (BigInt(previous) + 1n).toString();
        const options: NeutralCommitOptions = { grant: h.binding.memoryGrant, fence: h.fence,
          limits: { maxAppends: 1, maxRecords: 8, maxEncodedBytes: 1048576 } };
        const values = [
          ['memory-pending-controls', ['memory-pending-control-v1', 'u64'], { candidate_id: 'u64', state: 'pending', created_cursor: previous }],
          ['memory-fold-state', ['memory-state-v1', 'candidate', 'u64'], { candidate_id: 'u64', state: 'pending' }],
          ['memory-admission-outcomes', ['memory-admission-outcome-v1', 'u64'], { candidate_id: 'u64', scope_ref: 'memory-stage-b-scope',
            status: 'accepted', record_id: 'record-u64', cursor: previous, decision_receipt_digest: DIGEST, transaction_receipt_digest: DIGEST }],
        ] as const;
        const updates = values.map(([kind, key, value]) => ({ kind, key: JSON.stringify(key), version: previous, value: memoryJcs(value) }));
        const empty: NeutralAtomicUnit = { guards: [], records: [], appends: [], updates: [], indexWrites: [], relationships: [], barriers: [], purgeIntents: [] };
        await h.handle.transact(options, (tx) => tx.apply({ ...empty, updates }));
        // Qualified sparse high-water fixture: retain the actual kernel root,
        // seed only its prior counters; never enumerate a fabricated history.
        const roots = new PgRoots(h.pg.options, h.kernel.incarnation);
        await h.pg.tx.run(false, async (session) => {
          const base = await roots.capture(session, h.scopeBinding.scope, true);
          const root = await roots.put(session, base.root, 'chain', 'memory-journal', {
            head: DIGEST, allocation: previous, count: previous, disposed: false,
          });
          await session.execute({ text: `UPDATE "${h.pg.name}".scopes SET root=$1,version=$2,sequence=$2 WHERE key=$3`,
            values: [root, previous, roots.key(h.scopeBinding.scope)] });
        });
        const body = { schema_version: 1, event_id: `u64-${next}`, operation: 'capture', cursor: next, candidate_id: 'u64',
          recorded_at: NOW, to_state: 'pending', authorization_receipt_digest: DIGEST, previous_event_hash: DIGEST };
        const event = { ...body, event_hash: hostReceiptDigest('memory-journal-event', body) };
        const unit = { ...empty, guards: updates.map((row) => ({ kind: 'aggregate-version' as const,
          aggregateKind: row.kind, aggregateKey: row.key, version: previous })),
        updates: updates.map((row) => ({ ...row, version: next })), appends: [{ chain: 'memory-journal', kind: 'memory-journal-events',
          id: event.event_id, hash: event.event_hash, value: memoryJcs(event), expectation: { kind: 'head' as const, hash: DIGEST } }] };
        await h.handle.transact(options, (tx) => tx.apply(unit));
        for (const row of updates) expect((await h.handle.readAggregate(row.kind, row.key, h.binding.memoryGrant))?.version).toBe(next);
        const index = JSON.parse((await h.handle.query('scope-chain-index', memoryJcs({}), h.binding.memoryGrant)).data);
        expect(index).toMatchObject({ allocation: next, head: event.event_hash });
        const page = JSON.parse((await h.handle.query('memory-journal-page', memoryJcs({ after: previous, limit: 1 }), h.binding.memoryGrant)).data);
        expect(page.map((row: any) => JSON.parse(row.value.data).cursor)).toEqual([next]);
        const counters = await h.pg.tx.run(true, (session) => session.execute({ text:
          `SELECT version::text,sequence::text FROM "${h.pg.name}".scopes`, values: [] }));
        expect(counters.rows).toEqual([{ version: next, sequence: next }]);
        if (next === MAX) {
          await expect(h.handle.transact(options, (tx) => tx.apply({ ...unit, guards: [], updates: [], appends: [{ ...unit.appends[0]!,
            id: 'exhausted', expectation: { kind: 'head', hash: event.event_hash } }] }))).rejects.toBeDefined();
          expect(JSON.parse((await h.handle.query('scope-chain-index', memoryJcs({}), h.binding.memoryGrant)).data)).toEqual(index);
        }
      } finally { await h.close(); }
    });
  }
};
