import { describe, expect, it } from 'vitest';
import { pgEnabled } from '../storage/pg-driver.js';
import { memoryAppend, memoryGrant, memoryPgHost, memoryUnit } from './pg-host.js';

describe.skipIf(!pgEnabled)('scoped memory PostgreSQL queries', () => {
  it('should return all five scoped projections, stable pages and the retained resync chain head', async () => {
    const host = await memoryPgHost();
    try {
      const root = await host.open();
      const grant = memoryGrant();
      const bound = await root.bindNew(grant);
      const record = (id: string) => ({ key: JSON.stringify(['memory-record-v1', id]), contentHash: `digest-${id}`,
        bytes: { format: 'utf8' as const, data: JSON.stringify({ record_id: id, content: id }) } });
      const batch = (through: string) => ({ key: JSON.stringify(['memory-outbox-v1', through, `digest-${through}`]),
        contentHash: `digest-${through}`, bytes: { format: 'utf8' as const,
          data: JSON.stringify({ through_cursor_inclusive: through, operations: [] }) } });
      await bound.commitAtomic(memoryUnit({ appends: [memoryAppend('1')], records: [record('r1'), batch('1')] }));
      await bound.commitAtomic(memoryUnit({ appends: [memoryAppend('2', 'hash-1')], records: [record('r2'), batch('2')] }));
      const first = await bound.query('memory-journal-page', { after: '0', limit: 1 }, { limit: 1 });
      expect(first.records).toEqual([{ event_id: 'event-1', intent_hash: 'intent-1', cursor: '1' }]);
      expect(first.nextCursor).not.toBeNull();
      const fence = { fenceId: 'memory-consumer', epoch: '1', incarnation: root.incarnation, ownerId: grant.principalId };
      await root.provisionFence(grant, fence);
      await bound.journalRead(0, 10, 'memory-resync');
      const snapshot = await bound.capability('scope-outbox-v1').port.resync('memory-resync', fence);
      await bound.commitAtomic(memoryUnit({ appends: [memoryAppend('3', 'hash-2')] }));
      expect((await bound.query('memory-journal-page', { after: '0', limit: 1 }, { limit: 1, cursor: first.nextCursor })).records)
        .toEqual([{ event_id: 'event-2', intent_hash: 'intent-2', cursor: '2' }]);
      expect((await bound.snapshotRead(snapshot.snapshotRoot, 0, 10)).rows)
        .toEqual([{ chainId: 'memory-journal', headHash: 'hash-2', allocation: '2' }]);
      expect((await bound.query('scope-chain-index', {}, { limit: 10 })).records)
        .toEqual([{ chainId: 'memory-journal', headHash: 'hash-3', allocation: '3' }]);
      expect((await bound.query('memory-record-by-id', { record_id: 'r1' }, { limit: 1 })).records)
        .toEqual([{ record_id: 'r1', content: 'r1' }]);
      expect((await bound.query('memory-outbox-page', { after: '0', limit: 10 }, { limit: 10 })).records)
        .toEqual([{ through_cursor_inclusive: '1', operations: [] }, { through_cursor_inclusive: '2', operations: [] }]);
      expect((await bound.query('memory-accepted-snapshot', { system_as_of: '3', max_candidates: 10 }, { limit: 10 })).records).toEqual([]);
      const foreign = await root.bindNew(memoryGrant('foreign'));
      for (const [name, input] of [
        ['memory-journal-page', { after: '0', limit: 10 }], ['memory-outbox-page', { after: '0', limit: 10 }],
        ['memory-record-by-id', { record_id: 'r1' }], ['memory-accepted-snapshot', { system_as_of: '3', max_candidates: 10 }],
        ['scope-chain-index', {}],
      ] as const) expect((await foreign.query(name, input, { limit: 10 })).records).toEqual([]);
      await expect(foreign.query('memory-journal-page', { after: '0', limit: 1 }, { limit: 1, cursor: first.nextCursor })).rejects.toThrow();
    } finally { await host.close(); }
  });
});
