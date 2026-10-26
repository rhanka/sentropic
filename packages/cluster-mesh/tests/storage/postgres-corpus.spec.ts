import { describe, it } from 'vitest';
import { pgEnabled } from './pg-driver.js';
import { createPgFixture } from './pg-fixture.js';
import { pgCorpusClient } from './pg-client.js';
import { grantFor } from './authority-corpus.js';
import { runAtomicCorpus } from './atomic-corpus.js';
import { runStagedCorpus, type StagedCorpusStore } from './staged-corpus.js';
import { runBarrierCorpus, type BarrierCorpusStore } from './barrier-corpus.js';
import { runReplayCorpus, type ReplayCorpusStore } from './replay-corpus.js';
import { quotePgIdentifier, type PgRegisteredQuery, type InjectedPgDriver } from '../../src/storage/postgres/protocol.js';
import { StorageInvalidCommandError } from '../../src/storage/errors.js';
import type { PgScoped } from '../../src/storage/postgres/index.js';
const snapshotQuery: PgRegisteredQuery = async (_input, context) => {
  const schema = quotePgIdentifier(context.layout.dataSchema); const position = context.cursor as string | null ?? '0';
  const rows = (await context.session.execute({ text: `SELECT * FROM ${schema}.map_page($1::bigint,$2::bigint,$3::integer)`, values: [context.root, position, context.limit + 1] })).rows;
  const records = rows.slice(0, context.limit).flatMap((row) => {
    const [kind, key] = JSON.parse(String(row.key)) as string[];
    if (!['chain', 'index', 'record', 'aggregate', 'genesis'].includes(kind!) || row.value === null) return [];
    return [{ kind, key, value: JSON.parse(Buffer.from(row.value as Uint8Array).toString('utf8')) }];
  });
  return { records, nextCursor: rows.length > context.limit ? (BigInt(position) + BigInt(context.limit)).toString() : null };
};
describe.skipIf(!pgEnabled)('shared corpora on injected Postgres', () => {
  it('preserves the shared journal/checkpoint/poison/snapshot corpus', async () => {
    const descriptor = { contractVersion: 'v1', contractDigest: 'replay', schemaVersions: ['1'], requiredProfiles: [], optionalProfiles: [], chainKinds: ['test'], queryNames: ['scope-chain-index'], boundaries: ['scope'], pageLimits: { maxRecords: 100, maxEncodedBytes: 1048576 } };
    const fixture = await createPgFixture({ descriptor, queries: { 'scope-chain-index': snapshotQuery } });
    try {
      const original = fixture.options.driver; let fail = false;
      const driver: InjectedPgDriver = { transaction: (options, operation) => original.transaction(options, (session) => operation({ execute: (statement) => {
        if (fail && statement.text.startsWith(`INSERT INTO "${fixture.name}".journal`)) { fail = false; throw new StorageInvalidCommandError('injected journal rollback'); }
        return session.execute(statement);
      } })) };
      fixture.options.driver = driver; const root = await fixture.open();
      const grant = grantFor({ operations: ['read', 'write', 'maintain'] });
      const foreign = grantFor({ token: 'foreign', scope: { tenantId: 'tenant-a', workspaceId: 'foreign' }, operations: ['read', 'write', 'maintain'] });
      // E4 supersede: after a reopen only the surviving kernel may flush.
      // The stable client keeps its fence map and journal paths; only the
      // flush entry points follow the live bound (they reach the commit
      // guard, fenced and staged ops never do).
      const initial = await root.bindNew(grant);
      const initialForeign = await root.bindNew(foreign);
      let live = initial;
      let liveForeign = initialForeign;
      const client = (issued: typeof grant, bound: PgScoped, getLive: () => PgScoped) => {
        const base = pgCorpusClient(root, issued, bound);
        // The frozen shared corpus uses small numeric positions. Keep its
        // adapter local; PostgreSQL's public transport remains exact strings.
        const bounded = (value: unknown): unknown => {
          if (Array.isArray(value)) return value.map(bounded);
          if (!value || typeof value !== 'object') return value;
          return Object.fromEntries(Object.entries(value).map(([key, item]) => {
            if (['seq', 'from', 'to', 'watermark', 'cursor', 'lag', 'journalSeq'].includes(key) && typeof item === 'string' && /^(0|[1-9][0-9]*)$/.test(item)) {
              const number = Number(item);
              if (!Number.isSafeInteger(number)) throw new Error('shared corpus position exceeds its numeric fixture range');
              return [key, number];
            }
            return [key, bounded(item)];
          }));
        };
        const extra = {
          journalRead: async (consumer: string, after: number, limit: number) => bounded(await bound.journalRead(after, limit, consumer)),
          externalRead: async (after: number, limit: number) => bounded(await bound.journalRead(after, limit)),
          journalInspect: async (consumer: string) => bounded(await bound.journalInspect(consumer)),
          journalResync: async (...args: Parameters<PgScoped['journalResync']>) => bounded(await bound.journalResync(...args)),
          snapshotRead: async (...args: Parameters<PgScoped['snapshotRead']>) => bounded(await bound.snapshotRead(...args)),
          journalMarkPoison: bound.journalPoison.bind(bound),
          armExternalFailure: async () => { fail = true; },
          commitAtomic: (...args: Parameters<PgScoped['commitAtomic']>) => getLive().commitAtomic(...args),
          appendChain: (...args: Parameters<PgScoped['appendChain']>) => getLive().appendChain(...args),
        };
        return new Proxy(base, { get(target, property) { if (Object.hasOwn(extra, property)) return extra[property as keyof typeof extra]; const value = Reflect.get(target, property, target) as unknown; return typeof value === 'function' ? value.bind(target) : value; } }) as unknown as ReplayCorpusStore;
      };
      await runReplayCorpus(client(grant, initial, () => live), client(foreign, initialForeign, () => liveForeign), {
        rebind: async () => {
          const kernel = await fixture.open();
          live = await kernel.bind(grant);
          liveForeign = await kernel.bind(foreign);
          return client(grant, live, () => live);
        },
        bindWithoutMaintain: async () => { const weak = grantFor({ token: 'weak', operations: ['read', 'write'] }); const bound = await root.bindNew(weak); return client(weak, bound, () => bound); },
      });
    } finally { await fixture.close(); }
  });
  it('preserves the shared ordinary atomic contract with module effects', async () => {
    const fixture = await createPgFixture();
    try {
      const bound = await (await fixture.open()).bindNew(grantFor({ operations: ['read', 'write', 'maintain'] }));
      await bound.configureLifecycle('optional');
      await runAtomicCorpus(bound, { visibilityBarriers: true, relationships: true, purgeJobs: true });
    } finally { await fixture.close(); }
  });
  it('preserves the shared staged protocol and foreign-scope refusals', async () => {
    const fixture = await createPgFixture();
    try {
      const root = await fixture.open(); const grant = grantFor({ operations: ['read', 'write', 'maintain'] });
      const foreign = grantFor({ token: 'foreign', scope: { tenantId: 'foreign', workspaceId: 'workspace' }, operations: ['read', 'write', 'maintain'] });
      const bound = pgCorpusClient(root, grant, await root.bindNew(grant));
      const other = pgCorpusClient(root, foreign, await root.bindNew(foreign));
      await runStagedCorpus(bound as unknown as StagedCorpusStore, { breakAuthority: () => root.revoke(grant.token) }, other as unknown as StagedCorpusStore);
    } finally { await fixture.close(); }
  });
  it('preserves the shared dependent-barrier and imported tombstone contract', async () => {
    const fixture = await createPgFixture();
    try {
      const root = await fixture.open(); const grant = grantFor({ operations: ['read', 'write', 'maintain'] });
      await runBarrierCorpus(pgCorpusClient(root, grant, await root.bindNew(grant)) as unknown as BarrierCorpusStore);
    } finally { await fixture.close(); }
  });
});
