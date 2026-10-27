import { openModuleStorageCanonicalMemoryStoreV1, type CanonicalMemoryStorePort } from '@sentropic/engram/memory-substrate';
import type { NeutralAtomicUnit, NeutralMemoryHandle, NeutralWriterFence } from '../../src/engram-memory/neutral-contract.js';
import { MEMORY_DESCRIPTOR, MEMORY_PINNED_PROFILES } from '../../src/engram-memory/manifest.js';
import { createPostgresKernel } from '../../src/storage/postgres/index.js';
import type { ScopeGrant } from '../../src/storage/authority.js';
import { memoryPgHost, memoryHostComposed } from './pg-host.js';
import { verifyHostBinding } from '../../src/engram-memory/binding.js';
import { openMemoryMaintenance, type MemoryMaintenancePorts } from '../../src/engram-memory/host-maintenance.js';
import { CanonicalOwnershipError } from '../../src/storage/instance-ownership.js';
import type { InjectedPgDriver } from '../../src/storage/postgres/protocol.js';
import { readFile } from 'node:fs/promises';
import { openMemoryPostgresHostLedger } from '../../src/engram-memory/ledger.js';
import { memoryFailure, neutralQueryResult, neutralTransaction } from './memory-neutral.js';

export type MemoryCampaignHost = Awaited<ReturnType<typeof memoryCampaignHost>>;
export const memoryCampaignHost = async (existing?: Awaited<ReturnType<typeof memoryPgHost>>, commitHook?: () => Promise<void>) => {
  if (!process.env.CM_PG_URL) throw new Error('Stage B requires CM_PG_URL and real PostgreSQL');
  const pg = existing ?? await memoryPgHost();
  const { binding } = memoryHostComposed(pg.options.driver);
  const units: NeutralAtomicUnit[] = [];
  let kernel!: Awaited<ReturnType<typeof createPostgresKernel>>;
  let fence: NeutralWriterFence;
  let acquired = false;
  let expireCommit = false;
  let clockNow = '2026-10-27T00:00:00.000Z';
  const driver: InjectedPgDriver = { transaction: (options, operation) => pg.options.driver.transaction(options, async (session) => {
    const result = await operation(session);
    if (expireCommit && !options.readOnly) {
      expireCommit = false;
      // Run after the kernel's final renewal, on the actual committing
      // session. Only the installed deferred SQL trigger can reject this.
      await session.execute({ text: `UPDATE "${pg.name}".instance_ownership
        SET holder_until=clock_timestamp()-interval '1 second' WHERE module='engram-memory'`, values: [] });
    }
    return result;
  }) };
  let store: CanonicalMemoryStorePort;
  let maintenance: MemoryMaintenancePorts;
  // Host-owned read/maintain authority has no write operation. Engram never
  // sees this grant; every call also checks E7's independent maintain token.
  const hostReader: ScopeGrant<unknown> = { ...binding.maintainGrant, token: 'memory-host-reader', operations: ['read', 'maintain'] };
  const hostRead = async () => {
    await verifyHostBinding(kernel, binding, scope);
    return kernel.bind(hostReader);
  };
  const scope = binding.memoryGrant.scope;
  const scopeBinding = { scope, store_id: 'memory-stage-b-store',
    resolveScope: (ref: string) => ref === 'memory-stage-b-scope' ? scope : null };
  const castGrant = (grant: Parameters<NeutralMemoryHandle['query']>[2]) => {
    if (grant.moduleId !== 'engram-memory' || grant.scope.tenantId !== scope.tenantId || grant.scope.workspaceId !== scope.workspaceId)
      throw Object.assign(new Error('grant differs from the bound memory scope'), { code: 'unauthorized' });
    return grant as ScopeGrant<unknown>;
  };
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
          throw new CanonicalOwnershipError('instance-busy', 'store_id and scope must be bijective');
        await kernel.ownership!.verify(session);
      });
      if (acquired) throw Object.assign(new Error('a live canonical holder already owns this host handle'), { code: 'fence-conflict' });
      fence = { fenceId: kernel.ownership!.handle.instanceId, epoch: kernel.ownership!.handle.storageEpoch };
      await kernel.provisionFence(binding.memoryGrant, fence);
      acquired = true;
      return fence;
    }),
    checkFence: (grant, supplied) => guarded(async () => {
      await kernel.bind(castGrant(grant));
      if (!fence || supplied.fenceId !== fence.fenceId || supplied.epoch !== fence.epoch)
        throw Object.assign(new Error('canonical fence differs'), { code: 'fence-lost' });
    }),
    releaseFence: (supplied) => guarded(async () => {
      if (fence?.fenceId === supplied.fenceId && fence?.epoch === supplied.epoch) { await kernel.ownership!.release(); acquired = false; }
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
  const open = async (hydrate = true) => {
    kernel = await createPostgresKernel({ ...pg.options, driver, canonicalOwnership: { leaseMs: 1000 }, onCommitPossession: commitHook });
    await kernel.bindNew(binding.memoryGrant);
    await kernel.bindNew(binding.maintainGrant);
    await kernel.bindNew(hostReader);
    const maintained = await kernel.bind(binding.maintainGrant);
    const authorized = async <T,>(run: () => Promise<T>) => {
      await verifyHostBinding(kernel, binding, scope); return run();
    };
    maintenance = openMemoryMaintenance(binding, {
      grant: binding.maintainGrant,
      currentFence: () => authorized(() => maintained.journalFence()),
      checkpoint: (...args) => authorized(() => maintained.journalCheckpoint(...args)),
      poison: (...args) => authorized(() => maintained.journalPoison(...args)),
      retry: (...args) => authorized(() => maintained.journalRetry(...args)),
      resync: (...args) => authorized(() => maintained.journalResync(...args)),
      snapshot: async (...args) => (await hostRead()).snapshotRead(...args),
    });
    if (!hydrate) {
      await handle.acquireFence({ scope, store_id: scopeBinding.store_id, grant: binding.memoryGrant });
      return;
    }
    const opened = await openModuleStorageCanonicalMemoryStoreV1({ handle, grant: binding.memoryGrant,
      scope_binding: scopeBinding, clock: { now: () => clockNow }, deadline_at: '2026-10-27T01:00:00.000Z' });
    if (!opened.ok) throw new Error(`PostgreSQL memory open: ${opened.error.code}: ${opened.error.message}`);
    store = opened.value;
  };
  try {
    if (!existing) {
      const ledgerSql = await readFile(new URL('../../assets/storage/postgres/engram-memory/002-host-ledger.sql', import.meta.url), 'utf8');
      await pg.tx.run(false, async (session) => {
        await session.execute({ text: `CREATE TABLE "${pg.name}".host_memory_identity
          (scope text PRIMARY KEY,store_id text UNIQUE NOT NULL)`, values: [] });
        // E7's existing host-ledger asset; registration remains E2-owned.
        await session.execute({ text: ledgerSql.replaceAll('__MEMORY_SCHEMA__', `"${pg.name}_projection"`), values: [] });
      });
    }
    await open();
  } catch (error) { await kernel?.ownership?.release(); await pg.close(); throw error; }
  const ledger = await openMemoryPostgresHostLedger(pg.options.driver, `${pg.name}_projection`);
  return { pg, binding, handle, units, scopeBinding, ledger, get kernel() { return kernel; }, get store() { return store; },
    expireAtCommit: () => { expireCommit = true; },
    get maintenance() { return maintenance; }, get fence() { return fence; }, hostReader,
    hostReplay: async (after: string, limit: number, consumer: string) => (await hostRead()).journalRead(after, limit, consumer),
    reopen: async () => { await store.close(); clockNow = '2026-10-27T00:30:00.000Z'; await open(); },
    reopenBackend: async () => { await store.close(); await open(false); },
    close: async () => { try { await store.close(); } finally { await kernel.ownership?.release(); await pg.close(); } },
  };
};
