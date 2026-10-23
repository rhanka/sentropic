import { describe, expect, it } from 'vitest';
import { createPgFixture } from './pg-fixture.js';
import { pgEnabled } from './pg-driver.js';
import { grantFor } from './authority-corpus.js';
import { quotePgIdentifier, type PgRegisteredQuery } from '../../src/storage/postgres/protocol.js';
const chains: PgRegisteredQuery = async (_input, context) => {
  const schema = quotePgIdentifier(context.layout.dataSchema);
  let position = context.cursor as string | null;
  if (position === null) position = String((await context.session.execute({ text: `SELECT ${schema}.map_lower_bound($1::bigint,$2) AS position`, values: [context.root, '["chain",'] })).rows[0]!.position);
  const result = await context.session.execute({ text: `SELECT * FROM ${schema}.map_page($1::bigint,$2::bigint,$3::integer)`, values: [context.root, position, context.limit + 1] });
  const all = result.rows.filter((row) => String(row.key).startsWith('["chain",'));
  const records = all.slice(0, context.limit).map((row) => ({ chain: JSON.parse(String(row.key))[1], metadata: JSON.parse(Buffer.from(row.value as Uint8Array).toString('utf8')) }));
  return { records, nextCursor: all.length > context.limit ? (BigInt(position) + BigInt(context.limit)).toString() : null };
};
const descriptor = { contractVersion: 'v1', contractDigest: 'query-contract', schemaVersions: ['1'], requiredProfiles: [], optionalProfiles: [], chainKinds: ['test'], queryNames: ['scope-chain-index'], boundaries: ['scope'], pageLimits: { maxRecords: 100, maxEncodedBytes: 1048576 } };
describe.skipIf(!pgEnabled)('captured registered Postgres queries and resync', () => {
  it('retains query roots, refuses foreign capabilities and preserves poison through resync', async () => {
    const fixture = await createPgFixture({ descriptor, queries: { 'scope-chain-index': chains } });
    try {
      const root = await fixture.open(); const grant = grantFor({ operations: ['read', 'write', 'maintain'] }); const bound = await root.bindNew(grant);
      for (const id of ['a', 'b']) await bound.appendChain(id, { id, hash: id, bytes: '{}' }, { kind: 'absent', allocation: '0' });
      const first = await bound.capability('visibility-barriers-v1').port.query('scope-chain-index', {}, { limit: 1 });
      await bound.appendChain('c', { id: 'c', hash: 'c', bytes: '{}' }, { kind: 'absent', allocation: '0' });
      const next = await (await (await fixture.open()).bind(grant)).query('scope-chain-index', {}, { limit: 1, cursor: first.nextCursor });
      expect(next.records).toHaveLength(1); expect(next.nextCursor).toBeNull();
      expect((next.records[0] as { chain: string }).chain).toBe('b');
      const other = await root.bindNew(grantFor({ token: 'other', principalId: 'other', operations: ['read', 'write', 'maintain'] }));
      await expect(other.query('scope-chain-index', {}, { limit: 1, cursor: first.nextCursor })).rejects.toMatchObject({ code: 'denied' });
      const fence = { fenceId: 'consumer', epoch: '1', incarnation: root.incarnation, ownerId: grant.principalId }; await root.provisionFence(grant, fence);
      const delivery = await bound.journalRead(0, 3, 'resync'); await bound.journalPoison('resync', delivery.events[0]!.eventId, 'failure');
      const snapshot = await bound.capability('scope-outbox-v1').port.resync('resync', fence);
      await expect(bound.journalCheckpoint('resync', 0, snapshot.journalSeq, fence)).rejects.toMatchObject({ code: 'invalid-command' });
      let after = 0;
      for (let count = 0; count < 10; count += 1) { const page = await bound.snapshotRead(snapshot.snapshotRoot, after, 1); if (page.next === null) break; after = page.next; }
      expect(await bound.journalInspect('resync')).toMatchObject({ status: 'stalled', failedEvent: delivery.events[0]!.eventId });
      await expect(bound.journalCheckpoint('resync', 0, snapshot.journalSeq, fence)).rejects.toMatchObject({ code: 'invalid-command' });
    } finally { await fixture.close(); }
  });
});
