import { openModuleStorageCanonicalMemoryStoreV1, type CanonicalMemoryStorePort } from '@sentropic/engram/memory-substrate';
import { createMemoryNeutralHandle, type MemoryNeutralHandleAssembly } from '../../src/engram-memory/neutral-handle.js';
import { createPostgresKernel } from '../../src/storage/postgres/index.js';
import { memoryPgHost, memoryHostComposed } from './pg-host.js';
import { verifyHostBinding } from '../../src/engram-memory/binding.js';
import { openMemoryMaintenance, type MemoryMaintenancePorts } from '../../src/engram-memory/host-maintenance.js';
import type { InjectedPgDriver } from '../../src/storage/postgres/protocol.js';
import { readFile } from 'node:fs/promises';
import { openMemoryPostgresHostLedger } from '../../src/engram-memory/ledger.js';

export type MemoryCampaignHost = Awaited<ReturnType<typeof memoryCampaignHost>>;
// The installed campaign resolves this factory and kernel from packed bytes.
export const memoryCampaignHost = async (existing?: Awaited<ReturnType<typeof memoryPgHost>>, commitHook?: () => Promise<void>) => {
  if (!process.env.CM_PG_URL) throw new Error('Stage B requires CM_PG_URL and real PostgreSQL');
  const pg = existing ?? await memoryPgHost();
  const { binding } = memoryHostComposed(pg.options.driver);
  let kernel!: Awaited<ReturnType<typeof createPostgresKernel>>;
  let installed: MemoryNeutralHandleAssembly;
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
  // E7's host-only read/maintain grant covers journal and snapshot reads.
  const hostRead = async () => {
    await verifyHostBinding(kernel, binding, scope);
    return kernel.bind(binding.maintainGrant);
  };
  const scope = binding.memoryGrant.scope;
  const scopeBinding = { scope, store_id: 'memory-stage-b-store',
    resolveScope: (ref: string) => ref === 'memory-stage-b-scope' ? scope : null };
  const open = async (hydrate = true) => {
    kernel = await createPostgresKernel({ ...pg.options, driver, canonicalOwnership: { leaseMs: 1000 }, onCommitPossession: commitHook });
    installed = createMemoryNeutralHandle({ kernel, binding, driver, schemaName: pg.name, scope });
    const handle = installed.handle;
    await kernel.bindNew(binding.memoryGrant);
    await kernel.bindNew(binding.maintainGrant);
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
  return { pg, binding, get handle() { return installed.handle; }, get units() { return installed.units; },
    scopeBinding, ledger, get kernel() { return kernel; }, get store() { return store; },
    expireAtCommit: () => { expireCommit = true; },
    get maintenance() { return maintenance; }, get fence() { return installed.getFence()!; },
    hostReplay: async (after: string, limit: number, consumer: string) => (await hostRead()).journalRead(after, limit, consumer),
    reopen: async () => { await store.close(); clockNow = '2026-10-27T00:30:00.000Z'; await open(); },
    reopenBackend: async () => { await store.close(); await open(false); },
    close: async () => { try { await store.close(); } finally { await kernel.ownership?.release(); await pg.close(); } },
  };
};
