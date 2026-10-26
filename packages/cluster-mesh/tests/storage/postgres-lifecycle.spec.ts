import { describe, expect, it } from 'vitest';
import { createPgFixture } from './pg-fixture.js';
import { pgEnabled } from './pg-driver.js';
import { grantFor } from './authority-corpus.js';
import { runLifecycleCorpus, type LifecycleCorpusStore } from './lifecycle-corpus.js';
import { createPostgresKernel, type PgScoped } from '../../src/storage/postgres/index.js';
import { StorageInvalidCommandError } from '../../src/storage/errors.js';
import type { InjectedPgDriver } from '../../src/storage/postgres/protocol.js';
describe.skipIf(!pgEnabled)('actual Postgres lifecycle corpus', () => {
  it('preserves holds, shared bytes, typed dispositions and crash recovery with independent SQL evidence', async () => {
    const fixture = await createPgFixture();
    try {
      let before = false; let after = false;
      const driver: InjectedPgDriver = { transaction: async (options, operation) => {
        let completes = false;
        const value = await fixture.options.driver.transaction(options, (session) => operation({ execute: (statement) => {
          if (statement.text.includes('.map_put(') && String(statement.values[1]).startsWith('["purge-outcome",')) {
            completes = true;
            if (before) { before = false; throw new StorageInvalidCommandError('injected purge interruption'); }
          }
          return session.execute(statement);
        } }));
        if (completes && after) { after = false; throw new StorageInvalidCommandError('injected postcommit response interruption'); } return value;
      } };
      const root = await createPostgresKernel({ ...fixture.options, driver });
      const grant = grantFor({ operations: ['read', 'write', 'maintain'] });
      const client = (bound: PgScoped) => {
        const collect = async (kind: 'jobs' | 'outcomes' | 'notifications') => {
          const rows = []; let cursor: string | null = null;
          do { const page = await bound.purgeRead(kind, { cursor, limit: 20 }); rows.push(...page.records); cursor = page.nextCursor; } while (cursor);
          return rows;
        };
        const extra = {
          armPurgeFailure: async () => { before = true; }, armPurgeResponseFailure: async () => { after = true; },
          purgeJobIds: async () => (await collect('jobs')).map((row) => row.key),
          purgeEvidence: async () => ({ outcomes: (await collect('outcomes')).map((row) => row.value), notifications: (await collect('notifications')).map((row) => row.value) }),
          releaseHold: (target: string) => bound.holdTarget(target, null), releaseBlob: (id: string, owner: string) => bound.shareBlob(id, owner),
        };
        return new Proxy(bound, { get(target, property) { if (Object.hasOwn(extra, property)) return extra[property as keyof typeof extra]; const value = Reflect.get(target, property, target) as unknown; return typeof value === 'function' ? value.bind(target) : value; } }) as unknown as LifecycleCorpusStore;
      };
      await runLifecycleCorpus(client(await root.bindNew(grant)), {
        expectedRecordDisposition: 'erased', rebind: async () => client(await (await createPostgresKernel({ ...fixture.options, driver })).bind(grant)),
        bindWithoutMaintain: async () => client(await root.bindNew(grantFor({ token: 'weak', operations: ['read', 'write'] }))),
      });
      await fixture.tx.run(true, async (session) => {
        const rows = await session.execute({ text: `SELECT target,bytes,erased FROM "${fixture.name}".payloads WHERE target=ANY($1::text[])`, values: [['rec-purge-1', 'agg-purge-1', 'response-target', 'interrupt-target']] });
        expect(rows.rows).toHaveLength(4); expect(rows.rows.every((row) => row.bytes === null && row.erased === true)).toBe(true);
      });
    } finally { await fixture.close(); }
  });
});
