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

/** Closed per-item outcome of one reconciled job. */
export const RECONCILE_OUTCOMES = ['job-build-failed', 'job-published', 'still-pending', 'already-terminal',
  'unknown-job', 'status-unavailable', 'status-invalid', 'no-release', 'receipt-conflict', 'job-not-found',
  'job-conflict', 'binding-not-pending', 'binding-conflict'] as const;
export type ReconcileOutcome = typeof RECONCILE_OUTCOMES[number];

export interface ReconcileItemResult {
  readonly scopeId: string;
  readonly artifactId: string;
  readonly jobId: string;
  readonly outcome: ReconcileOutcome;
  /** Whether the job row moved to its terminal state. */
  readonly job: 'updated' | 'unchanged';
  /** Whether the binding moved from `build_pending` to `build_failed`. Untouched on success. */
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

/** Closed builder status shape; anything else is `status-invalid` and writes nothing. */
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
  Pick<ReconcileOptions, 'systemActorId'> {
  const olderThanMs = options.olderThanMs ?? RECONCILE_DEFAULTS.olderThanMs;
  const limit = options.limit ?? RECONCILE_DEFAULTS.limit;
  const concurrency = options.concurrency ?? RECONCILE_DEFAULTS.concurrency;
  if (!options || !options.jobs || !options.status || !options.bindings) throw new ReconcileError('reconcile_invalid_options', 'jobs, status and bindings are required');
  if (!Number.isFinite(olderThanMs) || olderThanMs < 0) throw new ReconcileError('reconcile_invalid_options', 'olderThanMs');
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIMIT) throw new ReconcileError('reconcile_invalid_options', 'limit');
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > MAX_CONCURRENCY) {
    throw new ReconcileError('reconcile_invalid_options', 'concurrency');
  }
  const systemActorId = options.systemActorId ?? 'system:reconcile-pending-builds';
  if (!systemActorId.trim()) throw new ReconcileError('reconcile_invalid_options', 'systemActorId');
  return { olderThanMs, limit, concurrency, systemActorId };
}

const unchanged = (key: { scopeId: string; artifactId: string; jobId: string }, outcome: ReconcileOutcome): ReconcileItemResult =>
  ({ ...key, outcome, job: 'unchanged', binding: 'unchanged' });

/** Binding `build_pending` to `build_failed` under the version CAS (`server/git-bindings.ts:51`,
 * action `publish`). The deterministic idempotency key replays a crashed reconcile instead of
 * appending a second event. Any concurrent move answers `binding-conflict` without touching the job. */
async function failBinding(options: Pick<ReconcileOptions, 'bindings' | 'systemActorId'> & { now: () => number },
  key: { scopeId: string; artifactId: string; jobId: string }, nowIso: string): Promise<ReconcileItemResult['binding'] | 'binding-conflict'> {
  const before: GitBinding | undefined = await options.bindings.get(key.scopeId, key.artifactId);
  if (!before || before.state !== 'build_pending' || before.pendingJobId !== key.jobId) return 'unchanged';
  const idempotencyKey = `reconcile-build-failed:${key.scopeId}:${key.artifactId}:${key.jobId}`;
  try {
    await options.bindings.write({
      binding: { ...before, state: 'build_failed', version: before.version + 1, updatedAt: nowIso },
      expectedVersion: before.version, actorId: options.systemActorId ?? 'system:reconcile-pending-builds', idempotencyKey,
      commandHash: orderedDigest({ operation: 'reconcile_build_failed', ...key }),
      event: { action: 'publish', beforeSha: before.releaseCommitSha ?? undefined, afterSha: before.pendingCommitSha ?? undefined,
        invocationId: `reconcile:${key.jobId}` },
    });
    return 'updated';
  } catch (error) {
    // A replayed receipt answers inside `write`; a concurrent move fails the version CAS and is
    // reported without touching the job outcome. The next run converges on the fresh state.
    if (error instanceof ArtifactOperationError &&
      (error.kind === 'pointer_conflict' || error.kind === 'git_binding_conflict' || error.kind === 'command_conflict')) {
      return 'binding-conflict';
    }
    throw error;
  }
}

async function reconcileOne(options: ReconcileOptions & { now: () => number },
  key: { scopeId: string; artifactId: string; jobId: string }): Promise<ReconcileItemResult> {
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
    const binding = await failBinding({ bindings: options.bindings, systemActorId: options.systemActorId, now: options.now },
      key, new Date(options.now()).toISOString());
    if (binding === 'binding-conflict') {
      const moved = await options.jobs.markFailed({ ...key, code: parsed.code ?? DEFAULT_CODE,
        ...(parsed.reason !== undefined ? { reason: parsed.reason } : {}) });
      return { ...key, outcome: 'binding-conflict', job: moved === 'updated' ? 'updated' : 'unchanged', binding: 'unchanged' };
    }
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
    if (receipt && releaseId !== undefined && receipt.releaseId !== releaseId) return unchanged(key, 'receipt-conflict');
    releaseId = receipt?.releaseId ?? releaseId;
  }
  if (releaseId === undefined) return unchanged(key, 'no-release');
  const moved = await options.jobs.markPublished({ ...key, releaseId });
  if (moved === 'not-found') return unchanged(key, 'job-not-found');
  if (moved === 'already-terminal') return unchanged(key, 'already-terminal');
  return { ...key, outcome: 'job-published', job: 'updated', binding: 'unchanged' };
}

/** On-demand reconcile of one pending job for the host read paths (`live_status`, `git_publish`,
 * `artifacts_get`). No age check; terminal rows and unknown builders write nothing. */
export async function reconcilePendingBuild(options: ReconcileOptions, key: { scopeId: string; artifactId: string; jobId: string }):
  Promise<ReconcileItemResult> {
  optionsOf(options);
  if (!key || !ID.test(key.scopeId) || !ID.test(key.artifactId) || !ID.test(key.jobId)) {
    throw new ReconcileError('reconcile_invalid_options', 'scopeId, artifactId and jobId are required');
  }
  return reconcileOne({ ...options, now: options.now ?? Date.now }, key);
}

/** Sweep of the host pending jobs older than the threshold. One builder failure never aborts the
 * sweep; every item reports its closed outcome. Rows are only moved to terminal states, never deleted. */
export async function reconcilePendingBuilds(options: ReconcileOptions): Promise<ReconcileReport> {
  const { olderThanMs, limit, concurrency } = optionsOf(options);
  const now = options.now ?? Date.now;
  const pending = await options.jobs.listPending({ nowMs: now(), olderThanMs, limit });
  const items: ReconcileItemResult[] = new Array(pending.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, Math.max(pending.length, 1)) }, async () => {
    for (;;) {
      const index = cursor++; if (index >= pending.length) return;
      const job = pending[index];
      items[index] = await reconcileOne({ ...options, now }, { scopeId: job.scopeId, artifactId: job.artifactId, jobId: job.jobId });
    }
  });
  await Promise.all(workers);
  return { checked: items.length, updated: items.filter(item => item.job === 'updated' || item.binding === 'updated').length, items };
}
