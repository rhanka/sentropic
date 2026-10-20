import type { ScopeGrant } from './authority.js';
import { StorageCapacityExceededError, StorageDeniedError, StorageInvalidCommandError } from './errors.js';
import type { KernelTransaction, ScopedRuntime } from './scope-runtime.js';
import type { CommitOptions } from './atomic.js';
import type { CommitReceipt } from './atomic.js';
import { ownedCopy, type JournalFence, type StagedCore } from './staged-core.js';
import { beginOperation, stageOperationFragment } from './staged-operations.js';
import { abortOperation, commitSealedOperation, inspectOperation, sealOperationStep } from './staged-seal.js';
import { captureRootSnapshot, checkpointRootJournal, inspectRootConsumer, pauseRootConsumer, poisonRootConsumer, readRootJournal, retryRootConsumer } from './root-journal.js';
import { readRootSnapshot } from './root-snapshot.js';
import { completeRootPurge, configureRootLifecycle, declareRootCoverage, holdRootTarget, shareRootBlob } from './root-lifecycle.js';
import type { PurgePolicy } from './staged-state.js';
import { stagedLimits } from './staged-operations.js';
import { rootCapability, STAGED_PROFILES } from './root-profiles.js';
import type { ProfileId } from './profiles.js';
import { captureManifestRoot, readManifestRootPage, verifyManifestRoot, type RootManifestRequest } from './root-manifest.js';
import { queryRoot, type RootQueryRequest } from './root-query.js';

/** Adapter-facing scope: all runtime state stays in true private slots. */
export class RootScopedRuntime {
  #core: StagedCore;
  #inner: ScopedRuntime;
  constructor(core: StagedCore, inner: ScopedRuntime) { this.#core = core; this.#inner = inner; Object.freeze(this); }
  get grant(): ScopeGrant<unknown> { return this.#inner.grant; }
  get scope() { return this.#inner.scope; }
  get moduleId() { return this.#inner.moduleId; }
  get profiles() { return STAGED_PROFILES; }
  capability<P extends ProfileId>(profile: P) { this.#core.kernel.bind(this.grant); return rootCapability(this, profile); }
  async query(name: string, input: unknown, options: RootQueryRequest) { return queryRoot(this.#core, this.#inner, name, input, options); }
  requireOperation(...args: Parameters<ScopedRuntime['requireOperation']>) { return this.#inner.requireOperation(...args); }
  appendChain(...args: Parameters<ScopedRuntime['appendChain']>) { return this.#inner.appendChain(...args); }
  genesis(...args: Parameters<ScopedRuntime['genesis']>) { return this.#inner.genesis(...args); }
  indexGet(...args: Parameters<ScopedRuntime['indexGet']>) { return this.#inner.indexGet(...args); }
  indexPut(...args: Parameters<ScopedRuntime['indexPut']>) { return this.#inner.indexPut(...args); }
  readHead(...args: Parameters<ScopedRuntime['readHead']>) { return this.#inner.readHead(...args); }
  readRecord(...args: Parameters<ScopedRuntime['readRecord']>) { return this.#inner.readRecord(...args); }
  readAggregate(...args: Parameters<ScopedRuntime['readAggregate']>) { return this.#inner.readAggregate(...args); }
  readChain(...args: Parameters<ScopedRuntime['readChain']>) { return this.#inner.readChain(...args); }
  readPage(...args: Parameters<ScopedRuntime['readPage']>) { return this.#inner.readPage(...args); }
  disposeChain(...args: Parameters<ScopedRuntime['disposeChain']>) { return this.#inner.disposeChain(...args); }
  commitAtomic(...args: Parameters<ScopedRuntime['commitAtomic']>) { return this.#inner.commitAtomic(...args); }
  transact<T>(options: CommitOptions, operation: (tx: KernelTransaction) => Promise<T>) { return this.#inner.transact(options, operation); }
  async beginStaged(input: Parameters<typeof beginOperation>[2]) { return beginOperation(this.#core, this.#inner, input); }
  async stageFragment(input: Parameters<typeof stageOperationFragment>[2]) { return stageOperationFragment(this.#core, this.#inner, input); }
  async sealStep(input: Parameters<typeof sealOperationStep>[2]) { return sealOperationStep(this.#core, this.#inner, input); }
  async commitStaged(input: Parameters<typeof commitSealedOperation>[2]) { return commitSealedOperation(this.#core, this.#inner, input); }
  async abortStaged(input: Parameters<typeof abortOperation>[2]) { return abortOperation(this.#core, this.#inner, input); }
  async inspectStaged(key: string) { return inspectOperation(this.#core, this.#inner, key); }
  async captureManifest(input: RootManifestRequest) { return captureManifestRoot(this.#core, this.#inner, input); }
  async verifyManifest(digest: string) { return verifyManifestRoot(this.#core, this.#inner, digest); }
  async manifestReadPage(digest: string, chainId: string, limit: number, cursor: unknown, bytes: number) { return readManifestRootPage(this.#core, this.#inner, digest, chainId, limit, cursor, bytes); }
  async journalFence() { return this.#core.journalFence(this.grant); }
  async journalRead(consumer: string, after: number, limit: number) { return readRootJournal(this.#core, this.#inner, after, limit, consumer); }
  async auditRead(after = 0, limit = 100): Promise<readonly Omit<CommitReceipt, 'moduleResult'>[]> {
    this.requireOperation('maintain'); this.requireOperation('read');
    const maximum = stagedLimits(this.#core);
    if (!Number.isSafeInteger(after) || after < 0 || !Number.isSafeInteger(limit) || limit <= 0 || limit > maximum.maxRecords) throw new StorageInvalidCommandError('invalid audit window');
    const audit = this.#core.data(this.#core.current(this.scope)).audit;
    const rows: Omit<CommitReceipt, 'moduleResult'>[] = [];
    let bytes = 0;
    for (let index = after; index < Math.min(audit.length, after + limit); index += 1) {
      const { moduleResult: _moduleResult, ...metadata } = audit.at(index)!;
      const size = Buffer.byteLength(JSON.stringify(metadata), 'utf8');
      if (bytes + size > maximum.maxEncodedBytes) throw new StorageCapacityExceededError('request a smaller audit window');
      rows.push(ownedCopy(metadata)); bytes += size;
    }
    return rows;
  }
  async externalRead(after: number, limit: number) { return readRootJournal(this.#core, this.#inner, after, limit); }
  async journalCheckpoint(consumer: string, expected: number, next: number, fence: JournalFence) { return checkpointRootJournal(this.#core, this.#inner, consumer, expected, next, fence); }
  async journalInspect(consumer: string) { return inspectRootConsumer(this.#core, this.#inner, consumer); }
  async journalMarkPoison(consumer: string, eventId: string, reason: string) { return poisonRootConsumer(this.#core, this.#inner, consumer, eventId, reason); }
  async journalPause(consumer: string, fence: JournalFence) { return pauseRootConsumer(this.#core, this.#inner, consumer, fence); }
  async journalRetry(consumer: string, expected: string | null, fence: JournalFence) { return retryRootConsumer(this.#core, this.#inner, consumer, expected, fence); }
  async journalResync(consumer: string, fence: JournalFence) { return captureRootSnapshot(this.#core, this.#inner, consumer, fence); }
  async snapshotRead(token: string, after: number, limit: number) { return readRootSnapshot(this.#core, this.#inner, token, after, limit); }
  async configureLifecycle(policy: PurgePolicy) { return configureRootLifecycle(this.#core, this.#inner, policy); }
  async declareCoverage(parent: string, child: string) { return declareRootCoverage(this.#core, this.#inner, parent, child); }
  async holdTarget(target: string, reason: string) { return holdRootTarget(this.#core, this.#inner, target, reason); }
  async releaseHold(target: string) { return holdRootTarget(this.#core, this.#inner, target, null); }
  async completePurge(intentId: string) { return completeRootPurge(this.#core, this.#inner, intentId); }
  async purgeProgress(intentId: string) {
    this.requireOperation('maintain');
    const job = this.#core.data(this.#core.current(this.scope)).jobs.get(intentId);
    if (!job) throw new StorageInvalidCommandError('unknown purge intent');
    return ownedCopy(job);
  }
  async purgeJobIds() {
    this.requireOperation('maintain');
    const jobs = this.#core.data(this.#core.current(this.scope)).jobs;
    if (jobs.size > stagedLimits(this.#core).maxRecords) throw new StorageCapacityExceededError('use the paged purge reader');
    return [...jobs.keys()];
  }
  async purgeEvidence(after = 0, limit = 100) {
    this.requireOperation('maintain');
    if (!Number.isSafeInteger(after) || after < 0 || !Number.isSafeInteger(limit) || limit <= 0 || limit > stagedLimits(this.#core).maxRecords) throw new StorageInvalidCommandError('invalid evidence window');
    const data = this.#core.data(this.#core.current(this.scope));
    const outcomes = [], notifications = [];
    for (let n = after; n < Math.min(data.outcomes.length, after + limit); n += 1) outcomes.push(data.outcomes.at(n)!);
    for (let n = after; n < Math.min(data.notifications.length, after + limit); n += 1) notifications.push(data.notifications.at(n)!);
    return ownedCopy({ outcomes, notifications, next: after + limit < data.outcomes.length ? after + limit : null });
  }
  async shareBlob(blobId: string, owner: string, bytes: string) { return shareRootBlob(this.#core, this.#inner, blobId, owner, bytes); }
  async releaseBlob(blobId: string, owner: string) { return shareRootBlob(this.#core, this.#inner, blobId, owner); }
  async readBlob(blobId: string) {
    this.requireOperation('read');
    const root = this.#core.current(this.scope);
    if (!this.#core.accessible(root, blobId)) throw new StorageDeniedError('blob is inaccessible');
    return this.#core.data(root).blobs.get(blobId)?.bytes ?? null;
  }
}
Object.freeze(RootScopedRuntime.prototype);
