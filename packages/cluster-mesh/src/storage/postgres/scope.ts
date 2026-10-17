import type { ScopeGrant } from '../authority.js';
import type { AtomicUnit, ChainExpectation, CommitOptions, CommitReceipt, IdempotencyEntry } from '../atomic.js';
import type { StorageScope } from '../contracts.js';
import type { ChainRecordInput } from '../record-runtime.js';
import { StorageDeniedError, StorageIdempotencyConflictError, StorageInvalidCommandError } from '../errors.js';
import { emptyEffects } from '../staged-preparation.js';
import { applyPgTransaction, ownPgValue, pgUnitDigest, runPgTransaction } from './ordinary-transactions.js';
import type { PgCore, PgTx } from './core.js';
import { PgView } from './readers.js';
import { pgJsonBytes } from './roots.js';
import { decodePgJson, decodePgUtf8 } from './codec.js';
import type { PgChain } from './effects.js';
import type { KernelTransaction } from '../scope-runtime.js';
const freeze = (value: unknown): void => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } };
export class PgScoped {
  readonly #core: PgCore;
  readonly #grant: ScopeGrant<unknown>;
  readonly scope: StorageScope;
  readonly moduleId: string;
  constructor(core: PgCore, supplied: ScopeGrant<unknown>) {
    this.#core = core; this.#grant = ownPgValue(supplied); freeze(this.#grant);
    this.scope = this.#grant.scope; this.moduleId = core.options.moduleId; Object.freeze(this);
  }
  async #read<T>(operation: (view: PgView) => Promise<T>): Promise<T> {
    const core = this.#core; const grant = this.#grant;
    return core.tx.run(true, async (session) => {
      await core.check(session, grant, 'read');
      const base = await core.roots.capture(session, grant.scope);
      const result = await operation(new PgView(core, session, grant, base.root));
      await core.check(session, grant, 'read'); return result;
    });
  }
  #transaction(tx: PgTx, options: CommitOptions) {
    const view = new PgView(this.#core, tx.session, this.#grant, tx.root, tx);
    return Object.freeze({
      apply: (unit: AtomicUnit) => applyPgTransaction(this.#core, this.#grant, tx, unit, options),
      readHead: view.readHead.bind(view), readRecord: view.readRecord.bind(view), readAggregate: view.readAggregate.bind(view),
      readChain: view.readChain.bind(view), findIdempotency: view.findIdempotency.bind(view), readRecords: view.readRecords.bind(view),
    });
  }
  async transact<T>(options: CommitOptions, operation: (tx: KernelTransaction) => Promise<T>) {
    return runPgTransaction(this.#core, this.#grant, options, (tx) => operation(this.#transaction(tx, options)));
  }
  async commitAtomic(input: AtomicUnit, options: CommitOptions = {}): Promise<CommitReceipt> {
    const unit = ownPgValue(input); const core = this.#core;
    if (options.idempotencyKey) {
      const replay = await core.tx.run(false, async (session) => {
        await core.check(session, this.#grant, 'write', true);
        if (options.fence) await core.fence(session, this.#grant, options.fence);
        const base = await core.roots.capture(session, this.scope);
        return core.roots.get<{ digest: string; receipt: CommitReceipt }>(session, base.root, 'commit', options.idempotencyKey!);
      });
      if (replay) {
        if (replay.digest !== pgUnitDigest([pgUnitDigest(unit)])) throw new StorageIdempotencyConflictError('atomic command identity conflict');
        return ownPgValue(replay.receipt);
      }
    }
    return (await this.transact(options, async (tx) => { await tx.apply(unit); })).receipt;
  }
  async appendChain(chainId: string, record: ChainRecordInput, expectation: ChainExpectation) {
    const owned = ownPgValue({ chainId, record, expectation });
    const result = await runPgTransaction(this.#core, this.#grant, {}, async (tx) => {
      const previous = await this.#core.roots.get<PgChain>(tx.session, tx.root, 'chain', chainId);
      await applyPgTransaction(this.#core, this.#grant, tx, { ...emptyEffects(), appends: [owned] }, {});
      return { seq: previous?.count ?? 0, hash: owned.record.hash, replayed: false as const };
    });
    return result.value;
  }
  readHead(chainId: string) { return this.#read((view) => view.readHead(chainId)); }
  readRecord(key: string) { return this.#read((view) => view.readRecord(key)); }
  readAggregate(key: string) { return this.#read((view) => view.readAggregate(key)); }
  indexGet(key: string) { return this.#read((view) => view.findIdempotency({ key })); }
  readPage(chainId: string, limit: number, cursor: unknown, maxEncodedBytes: number) { return this.#read((view) => view.readChain({ chainId, limit, cursor, maxEncodedBytes })); }
  async readChain(chainId: string) {
    return this.#read(async (view) => {
      const records = []; let cursor: string | null = null;
      do {
        const page = await view.readChain({ chainId, limit: 100, cursor, maxEncodedBytes: 1048576 });
        if (page.outcome !== 'page') throw new StorageDeniedError('chain payload is unavailable');
        records.push(...page.records); cursor = page.nextCursor;
      } while (cursor !== null);
      return records;
    });
  }
  async indexPut(key: string, entry: IdempotencyEntry): Promise<'insert' | 'replace'> {
    const owned = ownPgValue(entry);
    return (await runPgTransaction(this.#core, this.#grant, {}, async (tx) => {
      const previous = await this.#core.roots.get(tx.session, tx.root, 'index', key);
      await applyPgTransaction(this.#core, this.#grant, tx, { ...emptyEffects(), indexWrites: [{ key, ...owned }] }, {});
      return previous ? 'replace' as const : 'insert' as const;
    })).value;
  }
  async genesis(kind: string, id: string, hash: string, value: unknown) {
    const owned = ownPgValue(value); const key = JSON.stringify([kind, id]); const core = this.#core;
    return (await runPgTransaction(core, this.#grant, {}, async (tx) => {
      await core.visible(tx.session, tx.root, key);
      const previous = await core.roots.get<{ hash: string; payload: string }>(tx.session, tx.root, 'genesis', key);
      if (previous) { if (previous.hash !== hash) throw new StorageIdempotencyConflictError('genesis conflict'); tx.noop = true; return { hash, replayed: true }; }
      const bytes = pgJsonBytes(owned); if (bytes.length > core.work().maxEncodedBytes) throw new StorageInvalidCommandError('genesis exceeds work limits');
      const payload = await core.roots.payload(tx.session, this.scope, key, bytes, hash);
      tx.root = await core.roots.put(tx.session, tx.root, 'genesis', key, { hash, payload }); tx.count += 1; tx.records += 1; tx.digests.push(pgUnitDigest([kind, id, hash]));
      return { hash, replayed: false };
    })).value;
  }
  async readGenesis(kind: string, id: string): Promise<{ hash: string; value: unknown } | null> {
    const core = this.#core; const key = JSON.stringify([kind, id]);
    return core.tx.run(true, async (session) => {
      await core.check(session, this.#grant, 'read'); const base = await core.roots.capture(session, this.scope); await core.visible(session, base.root, key);
      const ref = await core.roots.get<{ hash: string; payload: string }>(session, base.root, 'genesis', key);
      return ref ? { hash: ref.hash, value: decodePgJson(decodePgUtf8(await core.roots.readPayload(session, this.scope, ref.payload))) } : null;
    });
  }
  async disposeChain(chainId: string): Promise<void> {
    await runPgTransaction(this.#core, this.#grant, {}, async (tx) => {
      await this.#core.check(tx.session, this.#grant, 'maintain');
      const chain = await this.#core.roots.get<PgChain>(tx.session, tx.root, 'chain', chainId);
      if (!chain) throw new StorageInvalidCommandError('unknown chain');
      tx.root = await this.#core.roots.put(tx.session, tx.root, 'disposed', chainId, true); tx.count += 1;
    });
  }
}
Object.freeze(PgScoped.prototype);
