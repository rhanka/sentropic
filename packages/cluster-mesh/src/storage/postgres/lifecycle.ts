import type { ScopeGrant } from '../authority.js';
import type { PurgePolicy, RootPurgeJob } from '../staged-state.js';
import { StorageDeniedError, StorageInvalidCommandError } from '../errors.js';
import type { PgCore } from './core.js';
import { runPgTransaction } from './ordinary-transactions.js';
import { decodePgCounter, decodePgText } from './codec.js';
import type { PgSession } from './protocol.js';
import { createPgInstalledContext } from './installed.js';
interface PgPurgeJob extends RootPurgeJob { readonly phase: 'payload' | 'staged'; readonly position: string | null; readonly found: boolean; }
const ancestors = async (core: PgCore, session: PgSession, root: string | null, target: string, match: (id: string) => Promise<boolean>, seen = new Set<string>()): Promise<boolean> => {
  if (seen.has(target)) return false;
  if (seen.size >= 128) throw new StorageInvalidCommandError('coverage path exceeds registered depth');
  seen.add(target); if (await match(target)) return true;
  for (const parent of await core.roots.get<readonly string[]>(session, root, 'parents', target) ?? []) if (await ancestors(core, session, root, parent, match, seen)) return true;
  return false;
};
const name = (value: string): void => { if (typeof value !== 'string' || !value || value.length > 4096) throw new StorageInvalidCommandError('invalid lifecycle identity'); };
export const configurePgLifecycle = async (core: PgCore, grant: ScopeGrant<unknown>, policy: PurgePolicy): Promise<void> => {
  if (!['unconfigured', 'optional', 'required'].includes(policy)) throw new StorageInvalidCommandError('unknown purge policy');
  await runPgTransaction(core, grant, {}, async (tx) => { await core.check(tx.session, grant, 'maintain'); tx.root = await core.roots.put(tx.session, tx.root, 'policy', 'purge', policy); tx.count += 1; });
};
export const declarePgCoverage = async (core: PgCore, grant: ScopeGrant<unknown>, parent: string, child: string): Promise<void> => {
  name(parent); name(child);
  await runPgTransaction(core, grant, {}, async (tx) => {
    if (await ancestors(core, tx.session, tx.root, parent, async (id) => id === child)) throw new StorageInvalidCommandError('coverage cycle');
    try { await core.visible(tx.session, tx.root, child); }
    catch (error) { if (error instanceof StorageDeniedError) throw new StorageInvalidCommandError('covered child cannot be reparented'); throw error; }
    tx.root = await core.roots.put(tx.session, tx.root, 'parents', child, [parent]); tx.count += 1;
  });
};
export const holdPgTarget = async (core: PgCore, grant: ScopeGrant<unknown>, target: string, reason: string | null): Promise<void> => {
  name(target); if (reason !== null) name(reason);
  await runPgTransaction(core, grant, {}, async (tx) => {
    await core.check(tx.session, grant, 'maintain'); tx.root = await core.roots.put(tx.session, tx.root, 'hold', target, reason); tx.count += 1;
  });
};
export const completePgPurge = async (core: PgCore, grant: ScopeGrant<unknown>, intentId: string): Promise<RootPurgeJob> => {
  name(intentId);
  const result = (await runPgTransaction(core, grant, {}, async (tx) => {
    await core.check(tx.session, grant, 'maintain');
    const store = core.roots; const session = tx.session;
    const policy = await store.get<string>(session, tx.root, 'policy', 'purge');
    if (!policy || policy === 'unconfigured') throw new StorageDeniedError('purge policy is not configured');
    const previous = await store.get<PgPurgeJob>(session, tx.root, 'purge-job', intentId);
    if (!previous) throw new StorageInvalidCommandError('unknown purge job');
    if (previous.state === 'complete') { tx.noop = true; return previous; }
    let job = { ...previous, phase: previous.phase ?? 'payload', position: previous.position ?? null, found: previous.found ?? false, state: 'pending' as PgPurgeJob['state'] };
    if (await ancestors(core, session, tx.root, job.target, async (id) => Boolean(await store.get(session, tx.root, 'hold', id)))) job.state = 'held';
    let work = 0; let bytes = 0;
    while (job.state !== 'held' && work < core.work().maxRecords) {
      const payload = job.phase === 'payload'; const table = payload ? 'payloads' : 'staged_items';
      const result = await session.execute({ text: `SELECT candidate.id::text,candidate.target,octet_length(candidate.bytes) AS cost FROM ${store.schema}.${table} AS candidate WHERE candidate.scope_key=$1 AND ($2::${payload ? 'text' : 'bigint'} IS NULL OR candidate.id>$2::${payload ? 'text' : 'bigint'}) ORDER BY candidate.id LIMIT 1`, values: [store.key(grant.scope), job.position] });
      const row = result.rows[0];
      if (!row) {
        if (payload) { job.phase = 'staged'; job.position = null; continue; }
        job.state = job.found ? 'complete' : 'failed'; break;
      }
      const id = payload ? decodePgText(row.id) : decodePgCounter(row.id); const target = row.target === null ? null : decodePgText(row.target);
      const covered = target !== null && await ancestors(core, session, tx.root, target, async (value) => value === job.target);
      if (covered) {
        job.found = true;
        const held = await ancestors(core, session, tx.root, target!, async (value) => Boolean(await store.get(session, tx.root, 'hold', value)) || ((await store.get<{ count: number }>(session, tx.root, 'blob', value))?.count ?? 0) > 0);
        if (held) { job.state = 'held'; break; }
        const cost = row.cost === null ? 0 : Number(row.cost);
        if (!Number.isSafeInteger(cost) || cost < 0 || cost > core.work().maxEncodedBytes) throw new StorageInvalidCommandError('purge item exceeds installed work budget');
        if (cost + bytes > core.work().maxEncodedBytes) break;
        if (!await store.get(session, tx.root, 'barrier', job.target)) tx.root = await store.put(session, tx.root, 'barrier', job.target, { reason: `purge:${intentId}`, createdAt: core.now() });
        await session.execute({ text: `UPDATE ${store.schema}.${table} SET bytes=NULL${payload ? ',erased=true' : ''} WHERE scope_key=$1 AND id=$2::${payload ? 'text' : 'bigint'}`, values: [store.key(grant.scope), id] });
        bytes += cost;
      }
      job.position = id; work += 1;
    }
    if (job.state === 'complete') {
      if (core.options.purgeFinalizer) {
        const installed = await createPgInstalledContext(core, grant, tx);
        await core.options.purgeFinalizer(job, installed.context); await installed.finish();
      }
      job = { ...job, outcomeId: core.id('purge-outcome'), payloadDisposition: 'erased' };
      tx.root = await store.put(session, tx.root, 'disposed', job.target, true);
      tx.root = await store.put(session, tx.root, 'purge-outcome', intentId, { intentId, outcomeId: job.outcomeId, target: job.target, disposition: 'erased' });
      tx.root = await store.put(session, tx.root, 'purge-notification', intentId, { intentId, outcomeId: job.outcomeId });
    }
    tx.root = await store.put(session, tx.root, 'purge-job', intentId, job); tx.count += 1;
    return job;
  })).value;
  return { target: result.target, intentId: result.intentId, authorizedBy: result.authorizedBy, state: result.state, outcomeId: result.outcomeId, payloadDisposition: result.payloadDisposition };
};
