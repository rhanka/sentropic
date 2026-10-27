import { openModuleStorageCanonicalMemoryStoreV1, type CanonicalMemoryStorePort } from '@sentropic/engram/memory-substrate';
import type { NeutralAtomicUnit, NeutralMemoryHandle, NeutralWriterFence } from '../../src/engram-memory/neutral-contract.js';
import { MEMORY_DESCRIPTOR, MEMORY_PINNED_PROFILES } from '../../src/engram-memory/manifest.js';
import { createPostgresKernel } from '../../src/storage/postgres/index.js';
import type { ScopeGrant } from '../../src/storage/authority.js';
import { memoryPgHost, memoryHostComposed } from './pg-host.js';
import { memoryFailure, neutralQueryResult, neutralTransaction } from './memory-neutral.js';

export type MemoryCampaignHost = Awaited<ReturnType<typeof memoryCampaignHost>>;
export const memoryCampaignHost = async () => {
  if (!process.env.CM_PG_URL) throw new Error('Stage B requires CM_PG_URL and real PostgreSQL');
  const pg = await memoryPgHost();
  const { binding } = memoryHostComposed(pg.options.driver);
  const units: NeutralAtomicUnit[] = [];
  let kernel: Awaited<ReturnType<typeof createPostgresKernel>>;
  let fence: NeutralWriterFence;
  let store: CanonicalMemoryStorePort;
  const scope = binding.memoryGrant.scope;
  const scopeBinding = { scope, store_id: 'memory-stage-b-store',
    resolveScope: (ref: string) => ref === 'memory-stage-b-scope' ? scope : null };
  const castGrant = (grant: Parameters<NeutralMemoryHandle['query']>[2]) => grant as ScopeGrant<unknown>;
  const guarded = async <T,>(run: () => Promise<T>): Promise<T> => {
    try { return await run(); } catch (error) { return memoryFailure(error); }
  };
  const handle: NeutralMemoryHandle = Object.freeze({
    moduleId: 'engram-memory', backend: 'postgres', descriptor: MEMORY_DESCRIPTOR,
    profiles: MEMORY_PINNED_PROFILES.filter((claim) => MEMORY_DESCRIPTOR.requiredProfiles.includes(claim.name)),
    acquireFence: (input) => guarded(async () => {
      if (JSON.stringify(input.scope) !== JSON.stringify(scope))
        throw Object.assign(new Error('foreign acquisition scope'), { code: 'unauthorized' });
      await kernel.bind(castGrant(input.grant));
      await pg.tx.run(false, async (session) => {
        await kernel.ownership!.verify(session);
        await session.execute({ text: `INSERT INTO "${pg.name}".host_memory_identity(scope,store_id) VALUES($1,$2)
          ON CONFLICT DO NOTHING`, values: [JSON.stringify(scope), input.store_id] });
        const rows = await session.execute({ text: `SELECT scope,store_id FROM "${pg.name}".host_memory_identity
          WHERE scope=$1 OR store_id=$2`, values: [JSON.stringify(scope), input.store_id] });
        if (rows.rows.length !== 1 || rows.rows[0]!.scope !== JSON.stringify(scope) || rows.rows[0]!.store_id !== input.store_id)
          throw Object.assign(new Error('store_id and scope must be bijective'), { code: 'fence-conflict' });
        await kernel.ownership!.verify(session);
      });
      fence = { fenceId: kernel.ownership!.handle.instanceId, epoch: kernel.ownership!.handle.storageEpoch };
      await kernel.provisionFence(binding.memoryGrant, fence);
      return fence;
    }),
    checkFence: (grant, supplied) => guarded(async () => {
      await kernel.bind(castGrant(grant));
      if (!fence || supplied.fenceId !== fence.fenceId || supplied.epoch !== fence.epoch)
        throw Object.assign(new Error('canonical fence differs'), { code: 'fence-lost' });
    }),
    releaseFence: (supplied) => guarded(async () => {
      if (fence?.fenceId === supplied.fenceId && fence?.epoch === supplied.epoch) await kernel.ownership!.release();
    }),
    transact: (options, operation) => guarded(async () => {
      const bound = await kernel.bind(castGrant(options.grant));
      return bound.transact(options, (tx) => operation(neutralTransaction(tx, units, options.idempotencyKey)));
    }),
    readAggregate: (kind, key, grant) => guarded(async () => {
      const row = await (await kernel.bind(castGrant(grant))).readAggregate(key);
      return row ? { kind, key, version: String(row.version), value: row.value as { format: 'utf8'; data: string } } : null;
    }),
    readCommitResult: (identity, grant) => guarded(async () =>
      (await (await kernel.bind(castGrant(grant))).readCommitResult(identity, fence)) as { format: 'utf8'; data: string } | null),
    query: (name, encoded, grant) => guarded(async () => {
      const input = JSON.parse(encoded.data);
      const bound = await kernel.bind(castGrant(grant));
      const page = await bound.query(name, input, { limit: input.limit ?? input.max_candidates ?? 2000 });
      return neutralQueryResult(name, page.records);
    }),
  });
  const open = async () => {
    kernel = await createPostgresKernel({ ...pg.options, canonicalOwnership: {} });
    await kernel.bindNew(binding.memoryGrant);
    await kernel.bindNew(binding.maintainGrant);
    const opened = await openModuleStorageCanonicalMemoryStoreV1({ handle, grant: binding.memoryGrant,
      scope_binding: scopeBinding, clock: { now: () => '2026-10-27T00:00:00.000Z' }, deadline_at: '2026-10-27T01:00:00.000Z' });
    if (!opened.ok) throw new Error(`PostgreSQL memory open: ${opened.error.code}: ${opened.error.message}`);
    store = opened.value;
  };
  try {
    await pg.tx.run(false, (session) => session.execute({ text: `CREATE TABLE "${pg.name}".host_memory_identity
      (scope text PRIMARY KEY,store_id text UNIQUE NOT NULL)`, values: [] }));
    await open();
  } catch (error) { await kernel!?.ownership?.release(); await pg.close(); throw error; }
  return { pg, binding, handle, units, scopeBinding, get kernel() { return kernel; }, get store() { return store; },
    reopen: async () => { await store.close(); await open(); },
    close: async () => { try { await store.close(); } finally { await pg.close(); } },
  };
};
