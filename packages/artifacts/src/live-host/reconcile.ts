import { orderedDigest } from '../profile/json.js';
import { ArtifactOperationError } from '../server/failures.js';
import type { GitBinding, GitBindingStore } from '../server/git-contracts.js';
import type { HostLedger } from './accept.js';
import { jobKey, type HandoffReceipt } from './handoff.js';

/** Builder status answer of `GET /v1/builds/:artifactId/:jobId` (contract #969): the host-facing
 * `GitBuildJobState` vocabulary, never the builder ledger states. A `published` status carries the
 * receipt `releaseId`; a `build_failed` status carries a closed builder `code` and its `reason`. */
export interface ReconcileBuilderStatus {
  readonly jobId: string;
  readonly state: 'build_pending' | 'published' | 'build_failed';
  readonly code?: string | undefined;
  readonly reason?: string | undefined;
  readonly releaseId?: string | undefined;
}

/** Pending host job the sweep may touch. `updatedAtMs` drives the older-than threshold. */
export interface ReconcilePendingJob {
  readonly scopeId: string;
  readonly artifactId: string;
  readonly jobId: string;
  readonly state: 'build_pending' | 'building';
  readonly updatedAtMs: number;
}

/** Host port: the pending-job store. Updates move a pending job to a terminal state only
 * (compare-and-swap on the pending state); rows are never deleted. */
export interface ReconcileJobStore {
  /** Jobs still pending, oldest first, bounded by `limit`. The host filters on `updatedAtMs`. */
  listPending(input: { nowMs: number; olderThanMs: number; limit: number }): Promise<readonly ReconcilePendingJob[]>;
  /** Current row, whatever its state; undefined when the host never recorded the job. */
  read(input: { scopeId: string; artifactId: string; jobId: string }):
    Promise<{ state: string; releaseId?: string | undefined } | undefined>;
  /** Pending to `build_failed` only; answers whether the row moved. Never regresses a terminal row. */
  markFailed(input: { scopeId: string; artifactId: string; jobId: string; code: string; reason?: string | undefined }):
    Promise<'updated' | 'already-terminal' | 'not-found'>;
  /** Pending to `published` with the receipt `releaseId`; answers whether the row moved. Never invents a release. */
  markPublished(input: { scopeId: string; artifactId: string; jobId: string; releaseId: string }):
    Promise<'updated' | 'already-terminal' | 'not-found'>;
}

/** Host port: the builder status client (immo `createHostBuildApiClient.status`). A transport
 * failure throws (the item is skipped as `status-unavailable`); an unknown job answers undefined. */
export interface ReconcileStatusClient {
  status(input: { scopeId: string; artifactId: string; jobId: string }):
    Promise<ReconcileBuilderStatus | undefined>;
}

/** Closed per-item outcome of one reconciled job. `store-error` is a per-item host-store outage:
 * the item is skipped and the sweep continues; only invalid options and the initial pending
 * listing throw. */
export const RECONCILE_OUTCOMES = ['job-build-failed', 'job-published', 'still-pending', 'already-terminal',
  'unknown-job', 'status-unavailable', 'status-invalid', 'no-release', 'receipt-conflict', 'job-not-found',
  'binding-not-pending', 'binding-conflict', 'store-error'] as const;
export type ReconcileOutcome = typeof RECONCILE_OUTCOMES[number];

export interface ReconcileItemResult {
  readonly scopeId: string;
  readonly artifactId: string;
  readonly jobId: string;
  readonly outcome: ReconcileOutcome;
  /** Whether the job row moved to its terminal state. */
  readonly job: 'updated' | 'unchanged';
  /** Whether the binding moved from `build_pending` to `build_failed`. Unchanged by reconcile on
   * the published path: the host publish transaction owns that transition, and a still-pending
   * binding is reported as `binding-not-pending`. */
  readonly binding: 'updated' | 'unchanged';
}

export interface ReconcileReport {
  readonly checked: number;
  readonly updated: number;
  readonly items: readonly ReconcileItemResult[];
}

export interface ReconcileOptions {
  /** Pending-job store of the host. */
  readonly jobs: ReconcileJobStore;
  /** Builder status client of the host. */
  readonly status: ReconcileStatusClient;
  /** Package git binding store; only `build_pending` to `build_failed` is ever written. */
  readonly bindings: Pick<GitBindingStore, 'get' | 'write'>;
  /** Optional receipt read: a builder `published` applies the stored receipt `releaseId` first. */
  readonly receipts?: Pick<HostLedger, 'find'> | undefined;
  /** Actor stamped on the binding `publish` event (default `system:reconcile-pending-builds`). */
  readonly systemActorId?: string | undefined;
  readonly now?: () => number;
  /** A pending job older than this is reconciled by the sweep (default 10 min). */
  readonly olderThanMs?: number | undefined;
  /** Upper bound of jobs per sweep (default 100, at most 500). */
  readonly limit?: number | undefined;
  /** Parallel status reads (default 4, at most 8). Store writes stay sequential per job. */
  readonly concurrency?: number | undefined;
}

/** Closed reconcile input errors; per-item builder outcomes stay data, never throws. */
export const RECONCILE_ERROR_CODES = ['reconcile_invalid_options'] as const;
export type ReconcileErrorCode = typeof RECONCILE_ERROR_CODES[number];
export class ReconcileError extends Error {
  constructor(readonly code: ReconcileErrorCode, detail?: string) {
    super(detail ? `${code}: ${detail}` : code); this.name = 'ReconcileError';
  }
}

export const RECONCILE_DEFAULTS = Object.freeze({ olderThanMs: 600_000, limit: 100, concurrency: 4 });
const MAX_LIMIT = 500; const MAX_CONCURRENCY = 8;
const DEFAULT_CODE = 'builder_unavailable';
const CODE_MAX = 128; const REASON_MAX = 1024; const RELEASE_MAX = 256;
const ID = /^[A-Za-z0-9_-]{1,128}$/;

const text = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.length >= 1 && value.length <= max;

/** Bounded builder status shape (length-bounded strings over the exact contract state set); anything
 * else is `status-invalid` and writes nothing. Extra keys are ignored: the builder is an
 * authenticated peer, so unknown fields stay data, never a refusal. A `published` status may carry
 * `code`/`reason` (ignored); a `build_failed` status without `code` gets the `builder_unavailable`
 * default at the call site. */
export function parseReconcileBuilderStatus(raw: unknown, jobId: string): ReconcileBuilderStatus | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const body = raw as Record<string, unknown>;
  if (body.jobId !== jobId || (body.state !== 'build_pending' && body.state !== 'published' && body.state !== 'build_failed')) {
    return undefined;
  }
  if (body.code !== undefined && !text(body.code, CODE_MAX)) return undefined;
  if (body.reason !== undefined && !text(body.reason, REASON_MAX)) return undefined;
  if (body.releaseId !== undefined && !text(body.releaseId, RELEASE_MAX)) return undefined;
  return { jobId, state: body.state,
    ...(body.code !== undefined ? { code: body.code as string } : {}),
    ...(body.reason !== undefined ? { reason: body.reason as string } : {}),
    ...(body.releaseId !== undefined ? { releaseId: body.releaseId as string } : {}) };
}

function optionsOf(options: ReconcileOptions): Required<Pick<ReconcileOptions, 'olderThanMs' | 'limit' | 'concurrency'>> &
  { systemActorId: string } {
  if (!options || typeof options !== 'object') throw new ReconcileError('reconcile_invalid_options', 'options are required');
  const ports = options as ReconcileOptions;
  if (!ports.jobs || !ports.status || !ports.bindings) {
    throw new ReconcileError('reconcile_invalid_options', 'jobs, status and bindings are required');
  }
  const olderThanMs = ports.olderThanMs ?? RECONCILE_DEFAULTS.olderThanMs;
  const limit = ports.limit ?? RECONCILE_DEFAULTS.limit;
  const concurrency = ports.concurrency ?? RECONCILE_DEFAULTS.concurrency;
  if (!Number.isFinite(olderThanMs) || olderThanMs < 0) throw new ReconcileError('reconcile_invalid_options', 'olderThanMs');
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIMIT) throw new ReconcileError('reconcile_invalid_options', 'limit');
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > MAX_CONCURRENCY) {
    throw new ReconcileError('reconcile_invalid_options', 'concurrency');
  }
  const systemActorId = ports.systemActorId ?? 'system:reconcile-pending-builds';
  if (typeof systemActorId !== 'string' || !systemActorId.trim()) {
    throw new ReconcileError('reconcile_invalid_options', 'systemActorId');
  }
  return { olderThanMs, limit, concurrency, systemActorId };
}

const unchanged = (key: { scopeId: string; artifactId: string; jobId: string }, outcome: ReconcileOutcome): ReconcileItemResult =>
  ({ ...key, outcome, job: 'unchanged', binding: 'unchanged' });

/** Binding `build_pending` to `build_failed` under the version CAS (`server/git-bindings.ts:51`,
 * action `publish`). The deterministic idempotency key replays a crashed reconcile instead of
 * appending a second event. The `live` key is never written (`validateGitBindingWrite` admits only
 * an absent `live`). A concurrent move answers `binding-conflict`; the caller still marks the job
 * failed per builder truth on that branch. */
async function failBinding(options: Pick<ReconcileOptions, 'bindings'> & { systemActorId: string },
  key: { scopeId: string; artifactId: string; jobId: string }, nowIso: string): Promise<ReconcileItemResult['binding'] | 'binding-conflict'> {
  const before: GitBinding | undefined = await options.bindings.get(key.scopeId, key.artifactId);
  if (!before || before.state !== 'build_pending' || before.pendingJobId !== key.jobId) return 'unchanged';
  const { live: _dropped, ...rest } = before;
  void _dropped;
  const idempotencyKey = `reconcile-build-failed:${key.scopeId}:${key.artifactId}:${key.jobId}`;
  try {
    await options.bindings.write({
      binding: { ...rest, state: 'build_failed', version: before.version + 1, updatedAt: nowIso },
      expectedVersion: before.version, actorId: options.systemActorId, idempotencyKey,
      commandHash: orderedDigest({ operation: 'reconcile_build_failed', ...key }),
      event: { action: 'publish', beforeSha: before.releaseCommitSha ?? undefined, afterSha: before.pendingCommitSha ?? undefined,
        invocationId: `reconcile:${key.jobId}` },
    });
    return 'updated';
  } catch (error) {
    // A replayed receipt answers inside `write`; a concurrent move fails the version CAS and is
    // reported so the job outcome stays truthful. The next run converges on the fresh state.
    if (error instanceof ArtifactOperationError &&
      (error.kind === 'pointer_conflict' || error.kind === 'git_binding_conflict' || error.kind === 'command_conflict')) {
      return 'binding-conflict';
    }
    throw error;
  }
}

async function reconcileOne(options: ReconcileOptions & { now: () => number; systemActorId: string },
  key: { scopeId: string; artifactId: string; jobId: string }): Promise<ReconcileItemResult> {
  const nowMs = options.now();
  if (!Number.isFinite(nowMs)) throw new ReconcileError('reconcile_invalid_options', 'now');
  let binding: ReconcileItemResult['binding'] = 'unchanged';
  try {
    const stored = await options.jobs.read(key);
    if (!stored) return unchanged(key, 'job-not-found');
    if (stored.state !== 'build_pending' && stored.state !== 'building') return unchanged(key, 'already-terminal');
    let answer: ReconcileBuilderStatus | undefined;
    try {
      answer = await options.status.status(key);
    } catch { return unchanged(key, 'status-unavailable'); }
    if (answer === undefined) return unchanged(key, 'unknown-job');
    const parsed = parseReconcileBuilderStatus(answer, key.jobId);
    if (!parsed) return unchanged(key, 'status-invalid');
    if (parsed.state === 'build_pending') return unchanged(key, 'still-pending');
    if (parsed.state === 'build_failed') {
      // The binding leads: a crash between the two writes still converges, because a rerun finds the
      // job pending and the binding already failed, then finishes the job move.
      const failed = await failBinding({ bindings: options.bindings, systemActorId: options.systemActorId },
        key, new Date(nowMs).toISOString());
      if (failed === 'binding-conflict') {
        const moved = await options.jobs.markFailed({ ...key, code: parsed.code ?? DEFAULT_CODE,
          ...(parsed.reason !== undefined ? { reason: parsed.reason } : {}) });
        return { ...key, outcome: 'binding-conflict', job: moved === 'updated' ? 'updated' : 'unchanged', binding: 'unchanged' };
      }
      binding = failed;
      const moved = await options.jobs.markFailed({ ...key, code: parsed.code ?? DEFAULT_CODE,
        ...(parsed.reason !== undefined ? { reason: parsed.reason } : {}) });
      if (moved === 'not-found') return { ...key, outcome: 'job-not-found', job: 'unchanged', binding };
      if (moved === 'already-terminal') return { ...key, outcome: 'already-terminal', job: 'unchanged', binding };
      return { ...key, outcome: 'job-build-failed', job: 'updated', binding };
    }
    // Builder `published`: the releaseId comes from the stored handoff receipt first, then from the
    // builder status; without either the job stays pending and no release is invented.
    let releaseId = parsed.releaseId;
    if (options.receipts) {
      const receipt: HandoffReceipt | undefined = await options.receipts.find(jobKey(key));
      if (receipt) {
        if (!text(receipt.releaseId, RELEASE_MAX)) return unchanged(key, 'receipt-conflict');
        if (releaseId !== undefined && receipt.releaseId !== releaseId) return unchanged(key, 'receipt-conflict');
        releaseId = receipt.releaseId;
      }
    }
    if (releaseId === undefined) return unchanged(key, 'no-release');
    const moved = await options.jobs.markPublished({ ...key, releaseId });
    if (moved === 'not-found') return unchanged(key, 'job-not-found');
    if (moved === 'already-terminal') return unchanged(key, 'already-terminal');
    // The binding is read, never written, on this path: a still-pending binding for this job is
    // reported so the host does not lose it now that the job row is terminal.
    const current = await options.bindings.get(key.scopeId, key.artifactId);
    if (current && current.state === 'build_pending' && current.pendingJobId === key.jobId) {
      return { ...key, outcome: 'binding-not-pending', job: 'updated', binding: 'unchanged' };
    }
    return { ...key, outcome: 'job-published', job: 'updated', binding: 'unchanged' };
  } catch {
    return { ...key, outcome: 'store-error', job: 'unchanged', binding };
  }
}

/** On-demand reconcile of one pending job for the host read paths (`live_status`, `git_publish`,
 * `artifacts_get`). No age check; terminal rows and unknown builders write nothing. */
export async function reconcilePendingBuild(options: ReconcileOptions, key: { scopeId: string; artifactId: string; jobId: string }):
  Promise<ReconcileItemResult> {
  const { systemActorId } = optionsOf(options);
  if (!key || !ID.test(key.scopeId) || !ID.test(key.artifactId) || !ID.test(key.jobId)) {
    throw new ReconcileError('reconcile_invalid_options', 'scopeId, artifactId and jobId are required');
  }
  return reconcileOne({ ...options, now: options.now ?? Date.now, systemActorId }, key);
}

/** Sweep of the host pending jobs older than the threshold. One per-item failure never aborts the
 * sweep: store and builder outages surface per item as `store-error`/`status-unavailable`. Only
 * invalid options and the initial pending listing throw. Rows are only moved to terminal states,
 * never deleted. */
export async function reconcilePendingBuilds(options: ReconcileOptions): Promise<ReconcileReport> {
  const { olderThanMs, limit, concurrency, systemActorId } = optionsOf(options);
  const now = options.now ?? Date.now;
  const pending = (await options.jobs.listPending({ nowMs: now(), olderThanMs, limit })).slice(0, limit);
  const items: ReconcileItemResult[] = new Array(pending.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, Math.max(pending.length, 1)) }, async () => {
    for (;;) {
      const index = cursor++; if (index >= pending.length) return;
      const job = pending[index];
      items[index] = await reconcileOne({ ...options, now, systemActorId },
        { scopeId: job.scopeId, artifactId: job.artifactId, jobId: job.jobId });
    }
  });
  await Promise.all(workers);
  return { checked: items.length, updated: items.filter(item => item.job === 'updated' || item.binding === 'updated').length, items };
}
