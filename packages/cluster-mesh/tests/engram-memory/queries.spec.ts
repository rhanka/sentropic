import { describe, expect, it } from 'vitest';
import { pgEnabled } from '../storage/pg-driver.js';
import { memoryAppend, memoryGrant, memoryPgHost, memoryUnit, memoryUpdate } from './pg-host.js';

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

  it('should apply scope filtering before candidate limits and retain historical accepted state', async () => {
    const host = await memoryPgHost();
    try {
      const bound = await (await host.open()).bindNew(memoryGrant());
      const record = (id: string, scope: string) => ({ record_id: id, scope_ref: scope, record_digest: `digest-${id}`,
        components: [{ component_id: 'primary', kind: 'decision', text: id }], primary_component_id: 'primary',
        citations: [{ source_ref: 'source' }], valid_time: { from: '2026-01-01' }, trust: { class: 'earned' } });
      const records = [record('a', 'foreign'), record('z', 'wanted')];
      await bound.commitAtomic(memoryUnit({
        records: records.map((value) => ({ key: JSON.stringify(['memory-record-v1', value.record_id]),
          contentHash: value.record_digest, bytes: { format: 'utf8', data: JSON.stringify(value) } })),
        updates: records.map((value) => memoryUpdate(['memory-state-v1', 'record', value.record_id], { state: 'accepted_current' })),
      }));
      const input = { system_as_of: '1', scope_ref: 'wanted', max_candidates: 1 };
      expect((await bound.query('memory-accepted-snapshot', input, { limit: 1 })).records).toEqual([{
        record_id: 'z', record_digest: 'digest-z', trust_class: 'earned', valid_time: { from: '2026-01-01' },
        fields: { primary: 'z', decision: 'z', context: '', evidence: '', citations: 'source' },
      }]);
      await bound.commitAtomic(memoryUnit({ updates: [memoryUpdate(['memory-state-v1', 'record', 'z'], { state: 'historical' }, 2)] }));
      expect((await bound.query('memory-accepted-snapshot', { ...input, system_as_of: '2' }, { limit: 1 })).records).toEqual([]);
      expect((await bound.query('memory-accepted-snapshot', input, { limit: 1 })).records).toHaveLength(1);
      await bound.commitAtomic(memoryUnit({ updates: [memoryUpdate(['memory-state-v1', 'record', 'z'], { state: 'accepted_current' }, 3)] }));
      expect((await bound.query('memory-accepted-snapshot', { ...input, system_as_of: '3' }, { limit: 1 })).records).toHaveLength(1);
    } finally { await host.close(); }
  });

  it('should order full-u64 outbox cursors exactly and refuse unavailable retained data', async () => {
    const host = await memoryPgHost();
    try {
      const root = await host.open();
      const grant = memoryGrant();
      const bound = await root.bindNew(grant);
      const cursors = ['9007199254740992', '9223372036854775808', '18446744073709551615'];
      await bound.commitAtomic(memoryUnit({ records: cursors.map((cursor) => ({
        key: JSON.stringify(['memory-outbox-v1', cursor, 'digest']), contentHash: cursor,
        bytes: { format: 'utf8', data: JSON.stringify({ through_cursor_inclusive: cursor }) },
      })) }));
      const first = await bound.query('memory-outbox-page', { after: '0', limit: 1 }, { limit: 1 });
      expect(first.records).toEqual([{ through_cursor_inclusive: cursors[0] }]);
      const second = await bound.query('memory-outbox-page', { after: '0', limit: 1 }, { limit: 1, cursor: first.nextCursor });
      expect(second.records).toEqual([{ through_cursor_inclusive: cursors[1] }]);
      expect((await bound.query('memory-outbox-page', { after: cursors[1], limit: 10 }, { limit: 10 })).records)
        .toEqual([{ through_cursor_inclusive: cursors[2] }]);
      await expect(bound.query('memory-outbox-page', { after: '18446744073709551616', limit: 1 }, { limit: 1 }))
        .rejects.toMatchObject({ code: 'invalid-command' });
      await root.revoke(grant.token);
      await expect(bound.query('memory-outbox-page', { after: '0', limit: 1 }, { limit: 1, cursor: first.nextCursor }))
        .rejects.toMatchObject({ code: 'denied' });
    } finally { await host.close(); }
  });
});
