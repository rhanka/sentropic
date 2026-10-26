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
      // Flush entry points follow the live bound; fenced journal ops stay on
      // the bound that owns the fence (they never reach the commit guard).
      let live = await root.bindNew(grant);
      let liveForeign = await root.bindNew(foreign);
      const client = (issued: typeof grant, get: () => PgScoped) => {
        const extra = {
          journalRead: (consumer: string, after: number, limit: number) => get().journalRead(after, limit, consumer),
          journalMarkPoison: (...args: Parameters<PgScoped['journalPoison']>) => get().journalPoison(...args),
          externalRead: (after: number, limit: number) => get().journalRead(after, limit),
          armExternalFailure: async () => { fail = true; },
          commitAtomic: (...args: Parameters<PgScoped['commitAtomic']>) => get().commitAtomic(...args),
          appendChain: (...args: Parameters<PgScoped['appendChain']>) => get().appendChain(...args),
        };
        return new Proxy({} as Record<string | symbol, unknown>, { get: (_target, property) => {
          if (Object.hasOwn(extra, property)) return (extra as Record<string | symbol, unknown>)[property];
          const base = pgCorpusClient(root, issued, get());
          const value = Reflect.get(base, property, base) as unknown;
          return typeof value === 'function' ? (value as (...args: never[]) => unknown).bind(base) : value;
        } }) as unknown as ReplayCorpusStore;
      };
      await runReplayCorpus(client(grant, () => live), client(foreign, () => liveForeign), {
        rebind: async () => {
          const kernel = await fixture.open();
          live = await kernel.bind(grant);
          liveForeign = await kernel.bind(foreign);
          return client(grant, () => live);
        },
        bindWithoutMaintain: async () => { const weak = grantFor({ token: 'weak', operations: ['read', 'write'] }); const bound = await root.bindNew(weak); return client(weak, () => bound); },
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
