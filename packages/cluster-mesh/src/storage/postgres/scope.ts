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
import { beginPgStaged, stagePgFragment, inspectPgStaged } from './staged.js';
import { abortPgStaged, commitPgStaged, sealPgStep, type PgSealRequest } from './seals.js';
import type { RootStageInput } from '../staged-operations.js';
import type { StagedBeginInput } from '../staged-units.js';
import type { AuthenticatedStagedHandle, AuthenticatedStagedSeal } from '../staged-state.js';
import type { WriterFence } from '../contracts.js';
import { configurePgLifecycle, declarePgCoverage, holdPgTarget, completePgPurge } from './lifecycle.js';
import type { PurgePolicy } from '../staged-state.js';
import {
  currentPgJournalFence,
  readPgJournal,
  checkpointPgJournal,
  inspectPgConsumer,
  operatePgConsumer,
} from './journal.js';
import type { JournalFence } from '../staged-core.js';
import { queryPgRoot, type PgQueryRequest } from './queries.js';
import { capturePgSnapshot, readPgSnapshot } from './snapshots.js';
import { capturePgManifest, verifyPgManifest, readPgManifestPage } from './manifests.js';
import type { RootManifestRequest } from '../root-manifest.js';
import { readPgBlob, sharePgBlob } from './blobs.js';
import { inspectPgPurge, readPgMaintenance, type PgMaintenanceRequest } from './maintenance-readers.js';
import { pgCapability, pgProfileClaims, type PgCapability } from './profiles.js';
import type { ProfileClaim, ProfileId } from '../profiles.js';
import { cleanupPgStaged, type PgCleanupRequest } from './cleanup.js';
import { runPgInstalled } from './installed.js';
const freeze = (value: unknown): void => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
};
export class PgScoped {
  readonly #core: PgCore;
  readonly #grant: ScopeGrant<unknown>;
  readonly scope: StorageScope;
  readonly moduleId: string;
  readonly profiles: readonly ProfileClaim[];
  constructor(core: PgCore, supplied: ScopeGrant<unknown>) {
    this.#core = core;
    this.#grant = ownPgValue(supplied);
    freeze(this.#grant);
    this.profiles = pgProfileClaims(
      core.options.moduleId,
      Boolean(core.options.descriptor?.queryNames.includes('scope-chain-index')),
    );
    this.scope = this.#grant.scope;
    this.moduleId = core.options.moduleId;
    Object.freeze(this);
  }
  async #read<T>(operation: (view: PgView) => Promise<T>): Promise<T> {
    const core = this.#core;
    const grant = this.#grant;
    return core.tx.run(true, async (session) => {
      await core.check(session, grant, 'read');
      const base = await core.roots.capture(session, grant.scope);
      const result = await operation(new PgView(core, session, grant, base.root));
      await core.check(session, grant, 'read');
      return result;
    });
  }
  #transaction(tx: PgTx, options: CommitOptions) {
    const view = new PgView(this.#core, tx.session, this.#grant, tx.root, tx);
    return Object.freeze({
      apply: (unit: AtomicUnit) => applyPgTransaction(this.#core, this.#grant, tx, unit, options),
      readHead: view.readHead.bind(view),
      readRecord: view.readRecord.bind(view),
      readAggregate: view.readAggregate.bind(view),
      readChain: view.readChain.bind(view),
      findIdempotency: view.findIdempotency.bind(view),
      readRecords: view.readRecords.bind(view),
    });
  }
  async transact<T>(options: CommitOptions, operation: (tx: KernelTransaction) => Promise<T>) {
    return runPgTransaction(this.#core, this.#grant, options, (tx) => operation(this.#transaction(tx, options)));
  }
  async commitAtomic(input: AtomicUnit, options: CommitOptions = {}): Promise<CommitReceipt> {
    const unit = ownPgValue(input);
    const core = this.#core;
    if (options.idempotencyKey) {
      const replay = await core.tx.run(false, async (session) => {
        await core.check(session, this.#grant, 'write', true);
        if (options.fence) await core.fence(session, this.#grant, options.fence);
        const base = await core.roots.capture(session, this.scope);
        return core.roots.get<{ digest: string; receipt: CommitReceipt }>(
          session,
          base.root,
          'commit',
          options.idempotencyKey!,
        );
      });
      if (replay) {
        if (replay.digest !== pgUnitDigest([pgUnitDigest(unit)]))
          throw new StorageIdempotencyConflictError('atomic command identity conflict');
        return ownPgValue(replay.receipt);
      }
    }
    return (
      await runPgTransaction(
        core,
        this.#grant,
        options,
        async (tx) => {
          await applyPgTransaction(core, this.#grant, tx, unit, options);
        },
        true,
      )
    ).receipt;
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
  readHead(chainId: string) {
    return this.#read((view) => view.readHead(chainId));
  }
  capability<P extends ProfileId>(profile: P): PgCapability<P> {
    return pgCapability(this, this.profiles, profile);
  }
  journalFence() {
    return currentPgJournalFence(this.#core, this.#grant);
  }
  readRecord(key: string) {
    return this.#read((view) => view.readRecord(key));
  }
  readAggregate(key: string) {
    return this.#read((view) => view.readAggregate(key));
  }
  beginStaged(input: StagedBeginInput) {
    return beginPgStaged(this.#core, this.#grant, input);
  }
  inspectStaged(key: string) {
    return inspectPgStaged(this.#core, this.#grant, key);
  }
  cleanupStaged(input: PgCleanupRequest) {
    return cleanupPgStaged(this.#core, this.#grant, input);
  }
  invoke(name: string, input: unknown) {
    return runPgInstalled(this.#core, this.#grant, name, input);
  }
  configureLifecycle(policy: PurgePolicy) {
    return configurePgLifecycle(this.#core, this.#grant, policy);
  }
  declareCoverage(parent: string, child: string) {
    return declarePgCoverage(this.#core, this.#grant, parent, child);
  }
  holdTarget(target: string, reason: string | null) {
    return holdPgTarget(this.#core, this.#grant, target, reason);
  }
  completePurge(intentId: string) {
    return completePgPurge(this.#core, this.#grant, intentId);
  }
  purgeProgress(intentId: string) {
    return inspectPgPurge(this.#core, this.#grant, intentId);
  }
  purgeRead(kind: 'jobs' | 'outcomes' | 'notifications', request: PgMaintenanceRequest) {
    return readPgMaintenance(this.#core, this.#grant, kind, request);
  }
  shareBlob(id: string, owner: string, bytes?: string) {
    return sharePgBlob(this.#core, this.#grant, id, owner, bytes);
  }
  readBlob(id: string) {
    return readPgBlob(this.#core, this.#grant, id);
  }
  journalRead(after: number, limit: number, consumer?: string) {
    return readPgJournal(this.#core, this.#grant, after, limit, consumer);
  }
  query(name: string, input: unknown, request: PgQueryRequest) {
    return queryPgRoot(this.#core, this.#grant, name, input, request);
  }
  journalResync(consumer: string, fence: JournalFence) {
    return capturePgSnapshot(this.#core, this.#grant, consumer, fence);
  }
  snapshotRead(token: string, after: number, limit: number) {
    return readPgSnapshot(this.#core, this.#grant, token, after, limit);
  }
  captureManifest(input: RootManifestRequest) {
    return capturePgManifest(this.#core, this.#grant, input);
  }
  verifyManifest(digest: string) {
    return verifyPgManifest(this.#core, this.#grant, digest);
  }
  manifestReadPage(digest: string, chainId: string, limit: number, cursor: unknown, bytes: number) {
    return readPgManifestPage(this.#core, this.#grant, digest, chainId, limit, cursor, bytes);
  }
  journalCheckpoint(consumer: string, expected: number, next: number, fence: JournalFence) {
    return checkpointPgJournal(this.#core, this.#grant, consumer, expected, next, fence);
  }
  journalInspect(consumer: string) {
    return inspectPgConsumer(this.#core, this.#grant, consumer);
  }
  journalPoison(consumer: string, event: string, reason: string) {
    return operatePgConsumer(this.#core, this.#grant, consumer, 'poison', event, reason);
  }
  journalPause(consumer: string, fence: JournalFence) {
    return operatePgConsumer(this.#core, this.#grant, consumer, 'pause', null, undefined, fence);
  }
  journalRetry(consumer: string, expected: string | null, fence: JournalFence) {
    return operatePgConsumer(this.#core, this.#grant, consumer, 'retry', expected, undefined, fence);
  }
  stageFragment(input: RootStageInput) {
    return stagePgFragment(this.#core, this.#grant, input);
  }
  sealStep(input: PgSealRequest) {
    return sealPgStep(this.#core, this.#grant, input);
  }
  commitStaged(input: { readonly seal: AuthenticatedStagedSeal; readonly fence: WriterFence }) {
    return commitPgStaged(this.#core, this.#grant, input.seal, input.fence);
  }
  abortStaged(input: {
    readonly unit: AuthenticatedStagedHandle;
    readonly fence: WriterFence;
    readonly reason: string;
  }) {
    return abortPgStaged(this.#core, this.#grant, input.unit, input.fence, input.reason);
  }
  indexGet(key: string) {
    return this.#read((view) => view.findIdempotency({ key }));
  }
  readPage(chainId: string, limit: number, cursor: unknown, maxEncodedBytes: number) {
    return this.#read((view) => view.readChain({ chainId, limit, cursor, maxEncodedBytes }));
  }
  async readChain(chainId: string) {
    return this.#read(async (view) => {
      const records = [];
      let cursor: string | null = null;
      do {
        const page = await view.readChain({ chainId, limit: 100, cursor, maxEncodedBytes: 1048576 });
        if (page.outcome !== 'page') throw new StorageDeniedError('chain payload is unavailable');
        records.push(...page.records);
        cursor = page.nextCursor;
      } while (cursor !== null);
      return records;
    });
  }
  async indexPut(key: string, entry: IdempotencyEntry): Promise<'insert' | 'replace'> {
    const owned = ownPgValue(entry);
    return (
      await runPgTransaction(this.#core, this.#grant, {}, async (tx) => {
        const previous = await this.#core.roots.get(tx.session, tx.root, 'index', key);
        await applyPgTransaction(
          this.#core,
          this.#grant,
          tx,
          { ...emptyEffects(), indexWrites: [{ key, ...owned }] },
          {},
        );
        return previous ? ('replace' as const) : ('insert' as const);
      })
    ).value;
  }
  async genesis(kind: string, id: string, hash: string, value: unknown) {
    const owned = ownPgValue(value);
    const key = JSON.stringify([kind, id]);
    const core = this.#core;
    return (
      await runPgTransaction(core, this.#grant, {}, async (tx) => {
        await core.visible(tx.session, tx.root, key);
        const previous = await core.roots.get<{ hash: string; payload: string }>(tx.session, tx.root, 'genesis', key);
        if (previous) {
          if (previous.hash !== hash) throw new StorageIdempotencyConflictError('genesis conflict');
          tx.noop = true;
          return { hash, replayed: true };
        }
        const bytes = pgJsonBytes(owned);
        if (bytes.length > core.work().maxEncodedBytes)
          throw new StorageInvalidCommandError('genesis exceeds work limits');
        const payload = await core.roots.payload(tx.session, this.scope, key, bytes, hash);
        tx.root = await core.roots.put(tx.session, tx.root, 'genesis', key, { hash, payload });
        tx.count += 1;
        tx.records += 1;
        tx.digests.push(pgUnitDigest([kind, id, hash]));
        return { hash, replayed: false };
      })
    ).value;
  }
  async readGenesis(kind: string, id: string): Promise<{ hash: string; value: unknown } | null> {
    const core = this.#core;
    const key = JSON.stringify([kind, id]);
    return core.tx.run(true, async (session) => {
      await core.check(session, this.#grant, 'read');
      const base = await core.roots.capture(session, this.scope);
      await core.visible(session, base.root, key);
      const ref = await core.roots.get<{ hash: string; payload: string }>(session, base.root, 'genesis', key);
      return ref
        ? {
            hash: ref.hash, value: decodePgJson(decodePgUtf8(await core.roots.readPayload(session, this.scope, ref.payload))) } : null;
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
