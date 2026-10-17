import type { ScopeGrant } from '../authority.js';
import type { EncodedValue } from '../contracts.js';
import type { IdempotencyEntry } from '../atomic.js';
import type { PurgePolicy } from '../staged-state.js';
import { StorageDeniedError, StorageInvalidCommandError, UnsupportedProfileError } from '../errors.js';
import type { PgCore, PgTx } from './core.js';
import { chainRecordKey, type PgChain, type PgChainRef } from './effects.js';
import { decodePgJson, decodePgUtf8 } from './codec.js';
import { applyPgTransaction, ownPgValue, pgReceipt, runPgTransaction } from './ordinary-transactions.js';
import type { PgInstalledContext } from './installed-contracts.js';
import { REGISTERED_PG_EFFECTS } from './registered-effects.js';
import { beginPgStaged, stagePgFragment, inspectPgStaged } from './staged.js';
export const createPgInstalledContext = async (core: PgCore, grant: ScopeGrant<unknown>, tx: PgTx, readOnly = false) => {
  const checks: (() => Promise<void>)[] = []; let closed = false;
  const live = () => { if (closed || tx.closed) throw new StorageInvalidCommandError('installed operation context is closed'); };
  const writable = () => { live(); if (readOnly) throw new StorageDeniedError('installed read operation cannot prepare canonical effects'); };
  const metadata = async (chain: string) => { live(); return core.roots.get<PgChain>(tx.session, tx.root, 'chain', chain); };
  const context: PgInstalledContext = Object.freeze<PgInstalledContext>({
    session: tx.session, get root() { live(); return tx.root; }, committedRoot: tx.base.root, rootVersion: tx.base.version, grant, layout: core.options.layout,
    stream: Object.freeze({ moduleId: core.options.moduleId, scope: grant.scope, incarnation: core.incarnation, stream: core.incarnation }),
    policy: await core.roots.get<PurgePolicy>(tx.session, tx.root, 'policy', 'purge') ?? 'unconfigured',
    available: async (target) => { live(); try { await core.visible(tx.session, tx.root, target); return true; } catch (error) { if (error instanceof StorageDeniedError) return false; throw error; } },
    headMetadata: metadata,
    head: async (chain: string) => {
      const head = await metadata(chain); if (!head) return null;
      const ref = await core.roots.get<PgChainRef>(tx.session, tx.root, 'chain-record', chainRecordKey(chain, head.count - 1));
      if (!ref || ref.hash !== head.head) throw new StorageInvalidCommandError('retained canonical head is incomplete');
      return { hash: head.head, sequence: head.count, bytes: decodePgUtf8(await core.roots.readPayload(tx.session, grant.scope, ref.payload)) };
    },
    aggregate: async (key: string) => {
      live(); const ref = await core.roots.get<{ version: number; payload: string }>(tx.session, tx.root, 'aggregate', key);
      return ref ? { version: ref.version, value: decodePgJson<EncodedValue>(decodePgUtf8(await core.roots.readPayload(tx.session, grant.scope, ref.payload))) } : null;
    },
    index: async (key: string) => { live(); return core.roots.get<IdempotencyEntry>(tx.session, tx.root, 'index', key); },
    apply: async (unit) => { writable(); await applyPgTransaction(core, grant, tx, unit, {}, REGISTERED_PG_EFFECTS); },
    revalidate: (check) => { live(); checks.push(check); tx.revalidators.add(check); },
    replayed: () => { live(); tx.noop = true; },
    beginStaged: (input) => { writable(); return beginPgStaged(core, grant, input); },
    stageFragment: (input) => { writable(); return stagePgFragment(core, grant, input); },
    inspectStaged: (operationKey) => { live(); return inspectPgStaged(core, grant, operationKey); },
  });
  return { context, finish: async () => { try { live(); for (const check of checks) await check(); } finally { closed = true; } } };
};
export const runPgInstalled = async (core: PgCore, grant: ScopeGrant<unknown>, name: string, supplied: unknown): Promise<unknown> => {
  const definition = core.options.operations && Object.hasOwn(core.options.operations, name) ? core.options.operations[name] : undefined;
  if (!definition || !['read', 'write', 'maintain'].includes(definition.operation) || typeof definition.execute !== 'function') throw new UnsupportedProfileError(`operation:${name}`);
  const input = ownPgValue(supplied);
  if (Buffer.byteLength(JSON.stringify(input), 'utf8') > core.work().maxEncodedBytes) throw new StorageInvalidCommandError('installed operation input exceeds work budget');
  if (definition.operation === 'read') {
    const read = async (tx: PgTx) => {
      await core.check(tx.session, grant, 'read');
      const scope = await createPgInstalledContext(core, grant, tx, true);
      const check = () => core.check(tx.session, grant, 'read'); tx.revalidators.add(check);
      const result = await definition.execute(input, scope.context); await scope.finish(); await check(); return ownPgValue(result);
    };
    const ambient = core.ambient.getStore();
    if (ambient) {
      if (ambient.closed || core.roots.key(ambient.scope) !== core.roots.key(grant.scope)) throw new StorageInvalidCommandError('installed read scope differs');
      try { return await read(ambient); } catch (error) { ambient.failed = error; throw error; }
    }
    return core.tx.run(false, async (session) => {
      const base = await core.roots.capture(session, grant.scope);
      const tx: PgTx = { session, scope: grant.scope, base, root: base.root, closed: false, failed: null, count: 0, records: 0, recordWrites: 0, appends: 0,
        encodedBytes: 0, receipt: pgReceipt(core, grant, base.sequence), barriers: 0, purges: 0, digests: [], contributors: new Map(), revalidators: new Set() };
      try { return await read(tx); } finally { tx.closed = true; }
    });
  }
  return (await runPgTransaction(core, grant, {}, async (tx) => {
    await core.check(tx.session, grant, definition.operation, true);
    const scope = await createPgInstalledContext(core, grant, tx);
    const result = await definition.execute(input, scope.context); await scope.finish(); return ownPgValue(result);
  })).value;
};
