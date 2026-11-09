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

/** Pending host job the sweep may touch. `updatedAtMs` drives the older-than threshold, enforced by
 * the sweep itself on top of the host filter, so a host that ignores the filter cannot fail fresh jobs. */
export interface ReconcilePendingJob {
  readonly scopeId: string;
  readonly artifactId: string;
  readonly jobId: string;
  readonly updatedAtMs: number;
}

/** Host port: the pending-job store. Updates move a pending job to a terminal state only
 * (compare-and-swap on the pending state); rows are never deleted. */
export interface ReconcileJobStore {
  /** Jobs still pending, oldest first, bounded by `limit`. The host filters on `updatedAtMs`; the sweep
   * re-checks the threshold itself, so a host that ignores the filter only wastes a status call. */
  listPending(input: { nowMs: number; olderThanMs: number; limit: number }): Promise<readonly ReconcilePendingJob[]>;
  /** Current row, whatever its state; undefined when the host never recorded the job. */
  read(input: { scopeId: string; artifactId: string; jobId: string }): Promise<{ state: string } | undefined>;
  /** Pending to `build_failed` only; answers whether the row moved. Never regresses a terminal row.
   * `code`/`reason` are hints: a host without those columns ignores them — the failure code is also
   * stamped on the binding `stateDetail` (package store), so it is never lost. */
  markFailed(input: { scopeId: string; artifactId: string; jobId: string; code?: string | undefined; reason?: string | undefined }):
    Promise<'updated' | 'already-terminal' | 'not-found'>;
  /** Pending to `published` with the receipt `releaseId`; answers whether the row moved. Never invents a release. */
  markPublished(input: { scopeId: string; artifactId: string; jobId: string; releaseId: string }):
    Promise<'updated' | 'already-terminal' | 'not-found'>;
}

/** Host port: the builder status client (immo `createHostBuildApiClient.status`). A transport
 * failure throws (the item is skipped as `status-unavailable`); an unknown job answers undefined.
 * `unknown-job` writes nothing and never converges by design (reconcile never deletes): the host must
 * bound such rows itself (alert or escalate after N sweeps) — e.g. a job recorded but never POSTed. */
export interface ReconcileStatusClient {
  status(input: { scopeId: string; artifactId: string; jobId: string }):
    Promise<ReconcileBuilderStatus | undefined>;
}

/** Closed per-item outcome of one reconciled job. `store-error` is a per-item host-store outage:
 * the item is skipped and the sweep continues; only invalid options and the initial pending
 * listing throw. */
export const RECONCILE_OUTCOMES = ['job-build-failed', 'job-published', 'still-pending', 'already-terminal',
  'unknown-job', 'status-unavailable', 'status-invalid', 'no-release', 'receipt-conflict', 'job-not-found',
  'binding-still-pending', 'binding-conflict', 'store-error'] as const;
export type ReconcileOutcome = typeof RECONCILE_OUTCOMES[number];

/** Bounded pipeline stage where a `store-error` struck. The stage names the throwing call without
 * exposing store internals, so a perpetual outage is alertable instead of silent. */
export const RECONCILE_ERROR_STAGES = ['list-pending', 'read-job', 'read-status', 'read-receipt', 'confirm-status',
  'write-binding', 'write-job', 'read-binding'] as const;
export type ReconcileErrorStage = typeof RECONCILE_ERROR_STAGES[number];

export interface ReconcileItemResult {
  readonly scopeId: string;
  readonly artifactId: string;
  readonly jobId: string;
  readonly outcome: ReconcileOutcome;
  /** Whether the job row moved to its terminal state. On `store-error` this reports the writes that
   * already committed before the failure, so a committed row is never reported `unchanged`. */
  readonly job: 'updated' | 'unchanged';
  /** Whether the binding moved from `build_pending` to `build_failed`. Unchanged by reconcile on
   * the published path: the host publish transaction owns that transition, and a still-pending
   * binding leaves the job pending too, reported as `binding-still-pending` for the next run. */
  readonly binding: 'updated' | 'unchanged';
  /** Present only on `store-error`: the stage that threw. */
  readonly error?: ReconcileErrorStage | undefined;
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
/** A builder failure without a machine code is still a builder failure, never an outage: the transport
 * answered. `builder_unavailable` is reserved for thrown transports (`status-unavailable`). */
const DEFAULT_CODE = 'build_failed';
const CODE_MAX = 128; const REASON_MAX = 1024; const RELEASE_MAX = 256;
const ID = /^[A-Za-z0-9_-]{1,128}$/;

const text = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.length >= 1 && value.length <= max;

/** Builder padding carries no signal: a blank code/reason is absent, so the default applies. */
const clean = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

/** Bounded builder status shape (length-bounded strings over the exact contract state set); anything
 * else is `status-invalid` and writes nothing. Extra keys are ignored: the builder is an
 * authenticated peer, so unknown fields stay data, never a refusal. A `published` status may carry
 * `code`/`reason` (ignored); a blank `code`/`reason` is dropped at the call site, and a `build_failed`
 * status without `code` gets the `build_failed` default there. */
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

/** Binding `build_pending` to `build_failed` under the version CAS (`server/git-bindings.ts:51`,
 * action `publish`). The failure code is stamped on the binding `stateDetail`, so hosts without
 * job `code`/`reason` columns lose nothing. The idempotency key and the command hash bind the
 * binding version and pending SHA: a re-pended job (the same `jobId` admitted again) writes anew
 * instead of replaying the older failure, and the `write()` result is verified so a stale replay
 * can never report `updated`. The `live` key is never written (`validateGitBindingWrite` admits only
 * an absent `live`). A concurrent move answers `binding-conflict`, except when the winner is the
 * success path (`attached`): then the publish owns the job close and the job is left alone. */
async function failBinding(options: Pick<ReconcileOptions, 'bindings'> & { systemActorId: string },
  key: { scopeId: string; artifactId: string; jobId: string }, stamp: { code: string; nowIso: string }):
  Promise<ReconcileItemResult['binding'] | 'binding-conflict' | 'binding-moved-on'> {
  const before: GitBinding | undefined = await options.bindings.get(key.scopeId, key.artifactId);
  if (!before || before.state !== 'build_pending' || before.pendingJobId !== key.jobId) return 'unchanged';
  const { live: _dropped, ...rest } = before;
  void _dropped;
  const idempotencyKey =
    `reconcile-build-failed:${key.scopeId}:${key.artifactId}:${key.jobId}:v${before.version}:${before.pendingCommitSha ?? ''}`;
  try {
    const written = await options.bindings.write({
      binding: { ...rest, state: 'build_failed', stateDetail: stamp.code, version: before.version + 1, updatedAt: stamp.nowIso },
      expectedVersion: before.version, actorId: options.systemActorId, idempotencyKey,
      commandHash: orderedDigest({ operation: 'reconcile_build_failed', ...key,
        expectedVersion: before.version, pendingCommitSha: before.pendingCommitSha }),
      event: { action: 'publish', beforeSha: before.releaseCommitSha ?? undefined, afterSha: before.pendingCommitSha ?? undefined,
        invocationId: `reconcile:${key.jobId}` },
    });
    // A replay answers inside `write`: it is only truthful for this exact version and SHA.
    const binding = written.binding;
    if (binding.state !== 'build_failed' || binding.version !== before.version + 1 || binding.pendingJobId !== key.jobId) {
      return 'binding-conflict';
    }
    return 'updated';
  } catch (error) {
    // A concurrent move fails the version CAS. Re-read before touching the job: when the winner is
    // the success path, failing the job would close a published artifact as failed.
    if (error instanceof ArtifactOperationError &&
      (error.kind === 'pointer_conflict' || error.kind === 'git_binding_conflict' || error.kind === 'command_conflict')) {
      const current = await options.bindings.get(key.scopeId, key.artifactId);
      if (current && current.state === 'attached') return 'binding-moved-on';
      return 'binding-conflict';
    }
    throw error;
  }
}

async function reconcileOne(options: ReconcileOptions & { now: () => number; systemActorId: string },
  key: { scopeId: string; artifactId: string; jobId: string }): Promise<ReconcileItemResult> {
  const nowMs = options.now();
  if (!Number.isFinite(nowMs)) throw new ReconcileError('reconcile_invalid_options', 'now');
  // Moved flags tracked across the catch: a failure after a committed write reports what committed.
  let job: ReconcileItemResult['job'] = 'unchanged';
  let binding: ReconcileItemResult['binding'] = 'unchanged';
  let error: ReconcileErrorStage = 'read-job';
  try {
    const stored = await options.jobs.read(key);
    if (!stored) return { ...key, outcome: 'job-not-found', job, binding };
    if (stored.state !== 'build_pending' && stored.state !== 'building') return { ...key, outcome: 'already-terminal', job, binding };
    error = 'read-status';
    let answer: ReconcileBuilderStatus | undefined;
    try {
      answer = await options.status.status(key);
    } catch { return { ...key, outcome: 'status-unavailable', job, binding }; }
    if (answer === undefined) return { ...key, outcome: 'unknown-job', job, binding };
    let parsed = parseReconcileBuilderStatus(answer, key.jobId);
    if (!parsed) return { ...key, outcome: 'status-invalid', job, binding };
    if (parsed.state === 'build_pending') return { ...key, outcome: 'still-pending', job, binding };
    // The stored handoff receipt is host proof of publication. When the receipts port is wired it is
    // read once for both terminal branches: a receipt overrides a stale builder `build_failed` (the
    // builder flips `failed` to `published` asynchronously in `record(receipt)`), and a missing
    // receipt fails a builder `published` closed (the builder word alone never publishes a job).
    let receipt: HandoffReceipt | undefined;
    if (options.receipts) {
      error = 'read-receipt';
      receipt = await options.receipts.find(jobKey(key));
      if (receipt && !text(receipt.releaseId, RELEASE_MAX)) return { ...key, outcome: 'receipt-conflict', job, binding };
      // A committed receipt overrides a stale builder `build_failed`: publication happened host-side.
      if (receipt && parsed.state === 'build_failed') {
        parsed = { jobId: key.jobId, state: 'published', releaseId: receipt.releaseId };
      }
    }
    if (parsed.state === 'build_failed' && !receipt) {
      // The builder ledger is not terminal on `failed`: `admit` re-runs the same `jobId` after a
      // failure, and a run in flight may still publish. Re-read the status just before the writes;
      // the fresher answer wins. `published` is terminal builder-side, so it needs no confirm.
      error = 'confirm-status';
      let confirm: ReconcileBuilderStatus | undefined;
      try {
        confirm = await options.status.status(key);
      } catch { return { ...key, outcome: 'status-unavailable', job, binding }; }
      if (confirm === undefined) return { ...key, outcome: 'unknown-job', job, binding };
      const fresh = parseReconcileBuilderStatus(confirm, key.jobId);
      if (!fresh) return { ...key, outcome: 'status-invalid', job, binding };
      if (fresh.state !== 'build_failed') parsed = fresh;
      if (parsed.state === 'build_pending') return { ...key, outcome: 'still-pending', job, binding };
    }
    if (parsed.state === 'build_failed') {
      // The binding leads: a crash between the two writes still converges, because a rerun finds the
      // job pending and the binding already failed, then finishes the job move.
      error = 'write-binding';
      const code = clean(parsed.code) ?? DEFAULT_CODE;
      const reason = clean(parsed.reason);
      const failed = await failBinding({ bindings: options.bindings, systemActorId: options.systemActorId },
        key, { code, nowIso: new Date(nowMs).toISOString() });
      if (failed === 'binding-moved-on') {
        return { ...key, outcome: 'binding-conflict', job, binding };
      }
      if (failed === 'binding-conflict') {
        error = 'write-job';
        const moved = await options.jobs.markFailed({ ...key, code, ...(reason !== undefined ? { reason } : {}) });
        if (moved === 'updated') job = 'updated';
        return { ...key, outcome: 'binding-conflict', job, binding };
      }
      binding = failed;
      error = 'write-job';
      const moved = await options.jobs.markFailed({ ...key, code, ...(reason !== undefined ? { reason } : {}) });
      if (moved === 'not-found') return { ...key, outcome: 'job-not-found', job, binding };
      if (moved === 'already-terminal') return { ...key, outcome: 'already-terminal', job, binding };
      job = 'updated';
      return { ...key, outcome: 'job-build-failed', job, binding };
    }
    // Builder `published`: the releaseId comes from the stored handoff receipt when the receipts port
    // is wired (a wired ledger without a receipt is `no-release`: the host never published), else
    // from the builder status; without either the job stays pending and no release is invented.
    let releaseId = parsed.releaseId;
    if (options.receipts) {
      if (!receipt) return { ...key, outcome: 'no-release', job, binding };
      if (releaseId !== undefined && receipt.releaseId !== releaseId) return { ...key, outcome: 'receipt-conflict', job, binding };
      releaseId = receipt.releaseId;
    }
    if (releaseId === undefined) return { ...key, outcome: 'no-release', job, binding };
    // The binding is read, never written, on this path — and before the job move: a still-pending
    // binding for this job leaves the job pending too, so the next run reconverges instead of
    // terminalizing the job over a lost binding write. A receipt that disagrees with the binding on
    // the commit SHA fails closed, as `publicationRecheck` would refuse it.
    error = 'read-binding';
    const current = await options.bindings.get(key.scopeId, key.artifactId);
    if (current && current.state === 'build_pending' && current.pendingJobId === key.jobId) {
      if (receipt && receipt.commitSha !== current.pendingCommitSha) return { ...key, outcome: 'receipt-conflict', job, binding };
      return { ...key, outcome: 'binding-still-pending', job, binding };
    }
    error = 'write-job';
    const moved = await options.jobs.markPublished({ ...key, releaseId });
    if (moved === 'not-found') return { ...key, outcome: 'job-not-found', job, binding };
    if (moved === 'already-terminal') return { ...key, outcome: 'already-terminal', job, binding };
    job = 'updated';
    return { ...key, outcome: 'job-published', job, binding };
  } catch {
    return { ...key, outcome: 'store-error', job, binding, error };
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
  const nowMs = now();
  const pending = (await options.jobs.listPending({ nowMs, olderThanMs, limit })).slice(0, limit);
  const items: ReconcileItemResult[] = new Array(pending.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, Math.max(pending.length, 1)) }, async () => {
    for (;;) {
      const index = cursor++; if (index >= pending.length) return;
      const row = pending[index];
      const key = { scopeId: String(row?.scopeId), artifactId: String(row?.artifactId), jobId: String(row?.jobId) };
      // The sweep validates what the host listed: malformed ids are a host-store defect, surfaced
      // per item instead of aborting the sweep.
      if (!row || !ID.test(row.scopeId) || !ID.test(row.artifactId) || !ID.test(row.jobId)) {
        items[index] = { ...key, outcome: 'store-error', job: 'unchanged', binding: 'unchanged', error: 'list-pending' };
        continue;
      }
      // The threshold is enforced here too, not only by the host filter: a listed job that is not
      // stale yet (or carries no usable age) is left pending without a single builder call.
      if (!Number.isFinite(row.updatedAtMs) || nowMs - row.updatedAtMs < olderThanMs) {
        items[index] = { ...key, outcome: 'still-pending', job: 'unchanged', binding: 'unchanged' };
        continue;
      }
      items[index] = await reconcileOne({ ...options, now, systemActorId }, key);
    }
  });
  await Promise.all(workers);
  return { checked: items.length, updated: items.filter(item => item.job === 'updated' || item.binding === 'updated').length, items };
}
