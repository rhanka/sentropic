/**
 * @sentropic/flow — per-job runner (shell lifecycle).
 *
 * Real reorganization (BR-26 Lot 7, slice 7.F.4): the shell of
 * `QueueManager.processJob` is extracted here as a pure function
 * `runJob(row, deps)` parametrized by a `JobRunnerDeps` adapter that
 * captures every side-effecting neighbour (DB writes, workflow
 * dispatch, executor invocation, abort/terminal-failure hooks).
 *
 * The shell covers:
 *   - header parsing + retry metadata extraction
 *   - claim-safety re-read (defensive guard against double-claims)
 *   - AbortController lifecycle (register + unregister)
 *   - workflow `markStarted` → executor → `complete` happy path
 *   - retry path (bounded, transient errors only)
 *   - `failWorkflowTask` + `markJobFailed` generic failure path
 *   - opt-in `onAbortedCancellation` hook (e.g. chat_message partial)
 *   - opt-in `onTerminalFailure` hook (e.g. document_summary status)
 *
 * The 10 executor bindings (organization_enrich, chat_message, …)
 * are NOT moved here — they remain instance methods of `QueueManager`
 * and are exposed to `runJob` via `deps.executors[jobType]`. The
 * queue-manager keeps a two-path bridge: if a job type has a registered
 * executor in `deps.executors` we route through `runJob`, otherwise we
 * fall through to the legacy in-place `switch`. Slices 7.F.4a..j peel
 * the bindings out of the switch one at a time.
 *
 * Slice 7.F.4a — skeleton + first executor binding (`executive_summary`).
 * Slices 7.F.4b..j — remaining 9 executor bindings.
 */

import type { WorkflowRuntimeContext } from './workflow-types.js';
import type { WorkflowTaskCompletion } from './dispatch.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Identity context passed to each executor binding. Most job executors
 * only need `(data, signal)`, but publishing/streaming jobs also need
 * the claimed queue row identity to write status/result side-effects.
 */
export interface JobRunnerExecutorContext<
  TJobRow = unknown,
  TJobType extends string = string,
> {
  row: TJobRow;
  jobId: string;
  jobType: TJobType;
  workspaceId: string;
  workflowTaskInstanceKey: string;
}

/**
 * Executor binding: a partial implementation of a single job type's
 * business logic. Returns an optional `WorkflowTaskCompletion` which
 * `runJob` will forward to `completeWorkflowTask` (so executors can
 * patch the run state / mark the run finished).
 */
export type JobRunnerExecutor<
  TJobData = unknown,
  TContext = JobRunnerExecutorContext,
> = (
  data: TJobData,
  signal: AbortSignal,
  context: TContext,
) => Promise<WorkflowTaskCompletion | void>;

/**
 * Result of the `claimReadStatus` deps call. The shell only checks
 * whether the row is still `processing`; anything else means it was
 * cancelled/purged and we skip.
 */
export type JobClaimStatus = string | null;

/**
 * Parameters forwarded to `markWorkflowTaskStarted` / `completeWorkflowTask`
 * / `failWorkflowTask` deps hooks. The deps adapter is responsible for
 * mapping these into the `@sentropic/flow/dispatch` parameter shapes
 * (inputPayload + attempts conversion).
 */
export interface RunJobWorkflowParams<TJobData = unknown> {
  workflow: WorkflowRuntimeContext;
  workspaceId: string;
  taskInstanceKey: string;
  jobData: TJobData;
}

export interface RunJobCompletionParams<TJobData = unknown>
  extends RunJobWorkflowParams<TJobData> {
  completion?: WorkflowTaskCompletion;
}

export interface RunJobFailureParams<TJobData = unknown>
  extends RunJobWorkflowParams<TJobData> {
  error: unknown;
}

export interface RunJobRetryParams<TJobData = unknown> {
  workflow: WorkflowRuntimeContext;
  workspaceId: string;
  taskInstanceKey: string;
  nextJobData: TJobData;
  retryAttempt: number;
  retryMax: number;
  errorMessage: string;
}

/**
 * Dependency adapter passed to `runJob`. Each method captures one
 * side-effecting neighbour. The queue-manager will bind these against
 * its own private helpers (db writes, workflow dispatch wrappers,
 * executor methods).
 */
export interface JobRunnerDeps<
  TJobRow = unknown,
  TJobType extends string = string,
  TJobData = unknown,
> {
  // -- header parse / derive -------------------------------------------------
  parseJobData(row: TJobRow): TJobData;
  getJobId(row: TJobRow): string;
  getJobType(row: TJobRow): TJobType;
  getWorkspaceId(row: TJobRow): string;
  getWorkflowContext(jobData: TJobData): WorkflowRuntimeContext | null;
  getWorkflowTaskInstanceKey(jobType: TJobType, jobData: TJobData): string;
  /** Build the next `jobData` payload for a retry attempt (merges `_retry`). */
  buildRetryJobData(
    jobData: TJobData,
    nextAttempt: number,
    retryMax: number,
  ): TJobData;

  // -- claim safety ----------------------------------------------------------
  /** Re-read the row status; if not `'processing'` the shell skips. */
  claimReadStatus(jobId: string): Promise<JobClaimStatus>;

  // -- controller lifecycle --------------------------------------------------
  registerController(jobId: string, controller: AbortController): void;
  unregisterController(jobId: string): void;

  // -- workflow lifecycle ----------------------------------------------------
  markWorkflowTaskStarted(params: RunJobWorkflowParams<TJobData>): Promise<void>;
  completeWorkflowTask(params: RunJobCompletionParams<TJobData>): Promise<void>;
  failWorkflowTask(params: RunJobFailureParams<TJobData>): Promise<void>;
  /** Persist a retry attempt to the workflow task result row. */
  upsertWorkflowTaskResultForRetry(
    params: RunJobRetryParams<TJobData>,
  ): Promise<void>;

  // -- job row writes --------------------------------------------------------
  markJobCompleted(jobId: string): Promise<void>;
  markJobFailed(jobId: string, errorMessage: string): Promise<void>;
  /** Re-queue the row for a bounded retry attempt. */
  requeueJobForRetry(params: {
    jobId: string;
    nextJobData: TJobData;
    retryAttempt: number;
    retryMax: number;
    errorMessage: string;
  }): Promise<void>;
  notifyJobEvent(jobId: string): Promise<void>;

  // -- executor registry -----------------------------------------------------
  executors: Partial<
    Record<TJobType, JobRunnerExecutor<TJobData, JobRunnerExecutorContext<TJobRow, TJobType>>>
  >;

  // -- failure hooks (no-op in 7.F.4a; bound by later slices) ----------------
  /**
   * Called inside `catch` when the error is an abort and the executor's
   * job type wants to finalize as `completed` with partial content
   * (chat_message). Returns `true` if the hook fully handled the
   * cancellation (the shell then skips the generic `markJobFailed`).
   */
  onAbortedCancellation(
    row: TJobRow,
    error: unknown,
    jobData: TJobData,
  ): Promise<boolean>;
  /**
   * Called after the generic `markJobFailed` for best-effort
   * side-effects (e.g. mirror the failure into `context_documents`
   * for `document_summary`). Must be best-effort: throwing here
   * does NOT roll back the job-failed status.
   */
  onTerminalFailure(
    row: TJobRow,
    error: unknown,
    jobData: TJobData,
  ): Promise<void>;
}

// ---------------------------------------------------------------------------
// Internal helpers (pure, non-exported)
// ---------------------------------------------------------------------------

interface RetryMeta {
  attempt: number;
  maxRetries: number;
}

function getRetryMeta(value: unknown): RetryMeta {
  if (!value || typeof value !== 'object') return { attempt: 0, maxRetries: 0 };
  const retry = (value as { _retry?: unknown })._retry;
  if (!retry || typeof retry !== 'object') return { attempt: 0, maxRetries: 0 };
  const attemptRaw = (retry as { attempt?: unknown }).attempt;
  const maxRaw = (retry as { maxRetries?: unknown }).maxRetries;
  const attempt =
    typeof attemptRaw === 'number' && Number.isFinite(attemptRaw)
      ? attemptRaw
      : Number(attemptRaw);
  const maxRetries =
    typeof maxRaw === 'number' && Number.isFinite(maxRaw) ? maxRaw : Number(maxRaw);
  return {
    attempt: Number.isFinite(attempt) ? Math.max(0, Math.floor(attempt)) : 0,
    maxRetries: Number.isFinite(maxRetries) ? Math.max(0, Math.floor(maxRetries)) : 0,
  };
}

function isAbort(err: unknown): boolean {
  if (!err) return false;
  if (err instanceof DOMException && err.name === 'AbortError') return true;
  if (err instanceof Error && err.name === 'AbortError') return true;
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes('AbortError') ||
    msg.includes('aborted') ||
    msg.includes('Request was aborted')
  );
}

function isRetryableInitiativeError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const lowerMsg = msg.toLowerCase();
  // JSON / format issues (LLM returned non-JSON or concatenated junk).
  if (
    msg.includes('Erreur lors du parsing') ||
    msg.includes('Invalid JSON') ||
    msg.includes('Unexpected non-whitespace character') ||
    msg.includes('No JSON object boundaries')
  ) {
    return true;
  }
  // Missing scores arrays leading to validateScores crash.
  if (msg.includes("Cannot read properties of undefined (reading 'map')")) {
    return true;
  }
  // Transient network / OpenAI-ish issues (best-effort).
  if (
    msg.includes('429') ||
    lowerMsg.includes('rate limit') ||
    msg.includes('ECONNRESET') ||
    msg.includes('ETIMEDOUT') ||
    msg.includes('ENOTFOUND')
  ) {
    return true;
  }
  return false;
}

function isRetryableWorkflowError(err: unknown): boolean {
  if (isRetryableInitiativeError(err)) {
    return true;
  }
  const msg = err instanceof Error ? err.message : String(err);
  const lowerMsg = msg.toLowerCase();
  return (
    lowerMsg.includes('aborterror') ||
    lowerMsg.includes('terminated') ||
    lowerMsg.includes('stream aborted') ||
    lowerMsg.includes('aborted') ||
    lowerMsg.includes('timed out') ||
    lowerMsg.includes('timeout') ||
    lowerMsg.includes('temporarily unavailable') ||
    lowerMsg.includes('upstream') ||
    lowerMsg.includes('overloaded') ||
    lowerMsg.includes('econnreset') ||
    lowerMsg.includes('etimedout') ||
    lowerMsg.includes('enotfound')
  );
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Execute a single claimed job row through the shell lifecycle. The
 * caller (queue-manager) is responsible for ensuring the row is in
 * `processing` status before invoking us; we re-read defensively
 * inside the `try` block (claim safety).
 *
 * Behavior parity contract: this function reproduces every observable
 * effect of the original `QueueManager.processJob` for the subset of
 * job types whose executor is registered in `deps.executors`. The
 * abort and terminal-failure side-effects that used to be inline
 * (chat_message finalize, document_summary status mirror) are now
 * routed through `onAbortedCancellation` / `onTerminalFailure`.
 */
export async function runJob<
  TJobRow,
  TJobType extends string,
  TJobData,
>(row: TJobRow, deps: JobRunnerDeps<TJobRow, TJobType, TJobData>): Promise<void> {
  const jobId = deps.getJobId(row);
  const jobType = deps.getJobType(row);
  const jobData = deps.parseJobData(row);
  const workflow = deps.getWorkflowContext(jobData);
  const workflowTaskInstanceKey = deps.getWorkflowTaskInstanceKey(jobType, jobData);
  const workspaceId = deps.getWorkspaceId(row);

  const { attempt: retryAttempt, maxRetries: retryMax } = getRetryMeta(jobData);

  let controller: AbortController | null = null;

  try {
    console.log(`🔄 Processing job ${jobId} (${jobType})`);

    // Safety: the job may have been purged between claim and processing start.
    // Also protects against any unexpected double-processing: only proceed
    // if the job row is still in `processing`.
    const status = await deps.claimReadStatus(jobId);
    if (!status || status !== 'processing') {
      console.log(
        `⏭️ Skipping job ${jobId}: missing or not processing (likely purged/claimed elsewhere)`,
      );
      return;
    }

    controller = new AbortController();
    deps.registerController(jobId, controller);

    if (workflow) {
      await deps.markWorkflowTaskStarted({
        workflow,
        workspaceId,
        taskInstanceKey: workflowTaskInstanceKey,
        jobData,
      });
    }

    const executor = deps.executors[jobType];
    if (!executor) {
      throw new Error(`Unknown job type: ${jobType}`);
    }
    const workflowCompletion =
      (await executor(jobData, controller.signal, {
        row,
        jobId,
        jobType,
        workspaceId,
        workflowTaskInstanceKey,
      })) ?? undefined;

    if (workflow) {
      await deps.completeWorkflowTask({
        workflow,
        workspaceId,
        taskInstanceKey: workflowTaskInstanceKey,
        jobData,
        completion: workflowCompletion,
      });
    }

    await deps.markJobCompleted(jobId);
    await deps.notifyJobEvent(jobId);

    console.log(`✅ Job ${jobId} completed successfully`);
  } catch (error) {
    console.error(`❌ Job ${jobId} failed:`, error);

    // Retry logic (bounded) for workflow jobs on transient/provider failures.
    // IMPORTANT: only suppress retries for explicit local cancellations.
    const wasCancelledLocally = controller?.signal.aborted === true;
    if (
      workflow &&
      retryMax > 0 &&
      retryAttempt < retryMax &&
      !wasCancelledLocally &&
      isRetryableWorkflowError(error)
    ) {
      const nextAttempt = retryAttempt + 1;
      const nextJobData = deps.buildRetryJobData(jobData, nextAttempt, retryMax);
      const msg = error instanceof Error ? error.message : 'Unknown error';
      await deps.upsertWorkflowTaskResultForRetry({
        workflow,
        workspaceId,
        taskInstanceKey: workflowTaskInstanceKey,
        nextJobData,
        retryAttempt,
        retryMax,
        errorMessage: msg,
      });
      await deps.requeueJobForRetry({
        jobId,
        nextJobData,
        retryAttempt: nextAttempt,
        retryMax,
        errorMessage: msg,
      });
      await deps.notifyJobEvent(jobId);
      console.warn(
        `🔁 Retrying job ${jobId} (${jobType}) attempt ${nextAttempt}/${retryMax}`,
      );
      return;
    }

    if (workflow) {
      await deps.failWorkflowTask({
        workflow,
        workspaceId,
        taskInstanceKey: workflowTaskInstanceKey,
        jobData,
        error,
      });
    }

    // Abort-with-partial-content hook (chat_message): the binding may
    // finalize the row as `completed` with a partial assistant message.
    if (isAbort(error)) {
      const handled = await deps.onAbortedCancellation(row, error, jobData);
      if (handled) {
        return;
      }
    }

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    await deps.markJobFailed(jobId, errorMessage);
    await deps.notifyJobEvent(jobId);

    // Best-effort terminal-failure side-effect (e.g. mirror failure into
    // `context_documents` for `document_summary`). Must be best-effort:
    // any throw here is swallowed by the deps binding.
    await deps.onTerminalFailure(row, error, jobData);
  } finally {
    deps.unregisterController(jobId);
  }
}
