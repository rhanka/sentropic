import type { ScopeGrant } from '../authority.js';
import type { EncodedValue } from '../contracts.js';
import type { IdempotencyEntry } from '../atomic.js';
import type { PurgePolicy } from '../staged-state.js';
import { StorageDeniedError, StorageInvalidCommandError, UnsupportedProfileError } from '../errors.js';
import type { PgCore, PgTx } from './core.js';
import { chainRecordKey, type PgChain, type PgChainRef } from './effects.js';
import { decodePgJson, decodePgUtf8 } from './codec.js';
import { applyPgTransaction, ownPgValue, runPgTransaction } from './ordinary-transactions.js';
import type { PgInstalledContext } from './installed-contracts.js';
import { REGISTERED_PG_EFFECTS } from './registered-effects.js';
export const createPgInstalledContext = async (core: PgCore, grant: ScopeGrant<unknown>, tx: PgTx) => {
  const checks: (() => Promise<void>)[] = []; let closed = false;
  const live = () => { if (closed || tx.closed) throw new StorageInvalidCommandError('installed operation context is closed'); };
  const metadata = async (chain: string) => { live(); return core.roots.get<PgChain>(tx.session, tx.root, 'chain', chain); };
  const context: PgInstalledContext = Object.freeze<PgInstalledContext>({
    session: tx.session, get root() { live(); return tx.root; }, grant, layout: core.options.layout,
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
    apply: async (unit) => { live(); await applyPgTransaction(core, grant, tx, unit, {}, REGISTERED_PG_EFFECTS); },
    revalidate: (check) => { live(); checks.push(check); tx.revalidators.add(check); },
    replayed: () => { live(); tx.noop = true; },
  });
  return { context, finish: async () => { try { live(); for (const check of checks) await check(); } finally { closed = true; } } };
};
export const runPgInstalled = async (core: PgCore, grant: ScopeGrant<unknown>, name: string, supplied: unknown): Promise<unknown> => {
  const definition = core.options.operations && Object.hasOwn(core.options.operations, name) ? core.options.operations[name] : undefined;
  if (!definition || !['write', 'maintain'].includes(definition.operation) || typeof definition.execute !== 'function') throw new UnsupportedProfileError(`operation:${name}`);
  const input = ownPgValue(supplied);
  if (Buffer.byteLength(JSON.stringify(input), 'utf8') > core.work().maxEncodedBytes) throw new StorageInvalidCommandError('installed operation input exceeds work budget');
  return (await runPgTransaction(core, grant, {}, async (tx) => {
    await core.check(tx.session, grant, definition.operation, true);
    const scope = await createPgInstalledContext(core, grant, tx);
    const result = await definition.execute(input, scope.context); await scope.finish(); return ownPgValue(result);
  })).value;
};
