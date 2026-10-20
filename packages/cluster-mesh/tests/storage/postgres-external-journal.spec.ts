import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createPgFixture } from './pg-fixture.js';
import { pgEnabled } from './pg-driver.js';
import { grantFor } from './authority-corpus.js';
import { StorageInvalidCommandError } from '../../src/storage/errors.js';
import type { PgJournalDraft, PgOutboxBinding, PgStreamIdentity } from '../../src/storage/postgres/protocol.js';
const streamKey = (stream: PgStreamIdentity) => JSON.stringify([stream.moduleId, stream.scope.tenantId, stream.scope.workspaceId, stream.incarnation, stream.stream]);
describe.skipIf(!pgEnabled)('alternate same-session journal binding', () => {
  it('rolls back with the root and delivers/checkpoints the same canonical log', async () => {
    const table = `public."outbox_${randomBytes(6).toString('hex')}"`; let fail = true;
    const binding: PgOutboxBinding = {
      append: async (session, stream, event) => {
        if (fail) { fail = false; throw new StorageInvalidCommandError('injected external rollback'); }
        await session.execute({ text: `INSERT INTO ${table}(stream,sequence,event_id,event,pid) VALUES($1,$2::bigint,$3,$4::jsonb,pg_backend_pid())`, values: [streamKey(stream), event.seq, event.eventId, JSON.stringify(event)] });
      },
      read: async (session, stream, after, limit) => (await session.execute({ text: `SELECT event FROM ${table} WHERE stream=$1 AND sequence>$2::bigint ORDER BY sequence LIMIT $3`, values: [streamKey(stream), after, limit] })).rows.map((row) => row.event as PgJournalDraft),
      find: async (session, stream, id) => (await session.execute({ text: `SELECT event FROM ${table} WHERE stream=$1 AND event_id=$2`, values: [streamKey(stream), id] })).rows[0]?.event as PgJournalDraft ?? null,
    };
    const fixture = await createPgFixture({ outbox: binding });
    try {
      await fixture.tx.run(false, (session) => session.execute({ text: `CREATE TABLE ${table}(stream text,sequence bigint,event_id text,event jsonb,pid integer,PRIMARY KEY(stream,sequence))`, values: [] }));
      const root = await fixture.open(); const grant = grantFor({ operations: ['read', 'write', 'maintain'] }); const bound = await root.bindNew(grant);
      await expect(bound.genesis('receipt', 'one', 'hash', {})).rejects.toMatchObject({ code: 'invalid-command' });
      expect(await bound.readGenesis('receipt', 'one')).toBeNull();
      await bound.genesis('receipt', 'one', 'hash', {});
      const read = await bound.journalRead(0, 10, 'external'); expect(read.events).toHaveLength(1);
      await bound.journalPoison('external', read.events[0]!.eventId, 'decode failure');
      const fence = { fenceId: 'external', epoch: '1', incarnation: root.incarnation, ownerId: grant.principalId }; await root.provisionFence(grant, fence);
      await bound.journalRetry('external', read.events[0]!.eventId, fence); await bound.journalRead(0, 10, 'external'); await bound.journalCheckpoint('external', 0, 1, fence);
      await fixture.tx.run(true, async (session) => {
        expect((await session.execute({ text: `SELECT count(*)::text AS count FROM "${fixture.name}".journal`, values: [] })).rows[0]!.count).toBe('0');
        expect((await session.execute({ text: `SELECT count(*)::text AS count FROM ${table}`, values: [] })).rows[0]!.count).toBe('1');
      });
    } finally {
      await fixture.tx.run(false, (session) => session.execute({ text: `DROP TABLE IF EXISTS ${table}`, values: [] })); await fixture.close();
    }
  });
});
