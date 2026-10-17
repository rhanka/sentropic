import type { AtomicUnit } from '../atomic.js';
import type { ScopeGrant } from '../authority.js';
import { StorageCasConflictError, StorageDeniedError, StorageIdempotencyConflictError, StorageInvalidCommandError } from '../errors.js';
import type { EncodedValue } from '../contracts.js';
import { decodePgJson, decodePgUtf8 } from './codec.js';
import { pgJsonBytes } from './roots.js';
import type { PgCore } from './core.js';
import type { PgSession } from './protocol.js';
import { applyPgModuleEffects } from './module-effects.js';
export interface PgChain { readonly head: string; readonly allocation: string; readonly count: number; readonly disposed: boolean; }
export interface PgRecordRef { readonly payload: string; readonly contentHash: string; }
export interface PgChainRef { readonly id: string; readonly seq: number; readonly hash: string; readonly payload: string; }
export const chainRecordKey = (chain: string, seq: number): string => JSON.stringify([chain, String(seq).padStart(16, '0')]);
export const applyPgEffects = async (core: PgCore, session: PgSession, grant: ScopeGrant<unknown>, initial: string | null, unit: AtomicUnit, coverageRoot = initial) => {
  const store = core.roots; const scope = grant.scope; let root = initial; let records = 0;
  for (const guard of unit.guards) {
    let accepted = false;
    if (guard.kind === 'head' || guard.kind === 'absent') {
      const chain = await store.get<PgChain>(session, root, 'chain', guard.chainId);
      accepted = guard.kind === 'head' ? chain?.head === guard.hash : chain === null;
    } else if (guard.kind === 'aggregate-version') {
      accepted = (await store.get<{ version: number }>(session, root, 'aggregate', guard.key))?.version === guard.version;
    } else if (guard.kind === 'predicate') {
      const predicate = core.options.pgPredicates?.[guard.predicateId];
      if (!predicate) throw new StorageInvalidCommandError('unregistered Postgres predicate');
      accepted = await predicate(guard.dependency, { session, root, stream: { moduleId: core.options.moduleId, scope, incarnation: core.incarnation, stream: core.incarnation } });
    }
    if (!accepted) throw new StorageCasConflictError('registered guard refused');
  }
  for (const target of [...unit.records.map((v) => v.key), ...unit.appends.map((v) => v.chainId), ...unit.updates.map((v) => v.key), ...unit.indexWrites.map((v) => v.key)]) {
    try { await core.visible(session, coverageRoot, target); }
    catch (error) { if (error instanceof StorageDeniedError) throw new StorageInvalidCommandError('covered mutation refused'); throw error; }
  }
  for (const record of unit.records) {
    const existing = await store.get<PgRecordRef>(session, root, 'record', record.key);
    if (existing) {
      const bytes = decodePgJson<EncodedValue>(decodePgUtf8(await store.readPayload(session, scope, existing.payload)));
      if (existing.contentHash !== record.contentHash || bytes.format !== record.bytes.format || bytes.data !== record.bytes.data) throw new StorageIdempotencyConflictError('immutable representation conflict');
      continue;
    }
    const payload = await store.payload(session, scope, record.key, pgJsonBytes(record.bytes), record.contentHash);
    root = await store.put(session, root, 'record', record.key, { payload, contentHash: record.contentHash }); records += 1;
  }
  for (const append of unit.appends) {
    const previous = await store.get<PgChain>(session, root, 'chain', append.chainId);
    if (previous?.disposed) throw new StorageInvalidCommandError('chain disposed');
    if (append.expectation.kind === 'absent') {
      if (append.expectation.allocation !== '0') throw new StorageInvalidCommandError('unexpected creation allocation');
      if (previous) throw new StorageIdempotencyConflictError('chain already exists');
    } else if (previous?.head !== append.expectation.hash) throw new StorageCasConflictError('stale chain head');
    const seq = previous?.count ?? 0;
    if (!Number.isSafeInteger(seq + 1)) throw new StorageInvalidCommandError('chain sequence exhausted');
    const payload = await store.payload(session, scope, append.chainId, Buffer.from(append.record.bytes, 'utf8'), append.record.hash);
    root = await store.put(session, root, 'chain-record', chainRecordKey(append.chainId, seq), { id: append.record.id, seq, hash: append.record.hash, payload });
    root = await store.put(session, root, 'chain', append.chainId, { head: append.record.hash, allocation: (BigInt(previous?.allocation ?? '0') + 1n).toString(), count: seq + 1, disposed: false }); records += 1;
  }
  for (const update of unit.updates) {
    const previous = await store.get<{ version: number }>(session, root, 'aggregate', update.key);
    if (previous && update.version <= previous.version) throw new StorageCasConflictError('stale aggregate version');
    const payload = await store.payload(session, scope, update.key, pgJsonBytes(update.value), String(update.version));
    root = await store.put(session, root, 'aggregate', update.key, { version: update.version, payload }); records += 1;
  }
  for (const write of unit.indexWrites) {
    const previous = await store.get<{ digest: string }>(session, root, 'index', write.key);
    if (previous && previous.digest !== write.digest) throw new StorageIdempotencyConflictError('command digest conflict');
    root = await store.put(session, root, 'index', write.key, { digest: write.digest, resultIds: write.resultIds, resultHash: write.resultHash });
  }
  root = await applyPgModuleEffects(core, session, grant, root, unit);
  await core.options.projection?.(unit, { session, root, layout: core.options.layout, grant, stream: { moduleId: core.options.moduleId, scope, incarnation: core.incarnation, stream: core.incarnation } });
  return { root, records, appends: unit.appends.length };
};
