/**
 * @sentropic/flow — JobQueue port.
 *
 * Postgres-based job queue with lease/heartbeat/DLQ/idempotency. The
 * concrete `JobType` and `JobData` unions live in the application
 * because they are tied to specific executor implementations
 * (organization_enrich, matrix_generate, etc.). The package keeps
 * them as generic parameters so future consumers can plug their own.
 *
 * Mirrors the public surface of `QueueManager` in
 * `api/src/services/queue-manager.ts`.
 *
 * Per spec/SPEC_EVOL_BR26_FLOW_FACADE.md §2.
 */

export interface QueuedJob<TJobType = string, TJobData = unknown> {
  id: string;
  type: TJobType;
  data: TJobData;
  streamId: string;
  result?: unknown;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  workspaceId?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

export interface EnqueueOptions {
  workspaceId?: string;
  /**
   * Max number of retries after the initial attempt.
   * - 0 => 1 total attempt (default)
   * - 1 => up to 2 total attempts
   */
  maxRetries?: number;
}

export interface DispatchWorkflowEntryParams {
  workspaceId: string;
  workflowRunId: string;
  workflowDefinitionId: string;
}

export interface WorkflowDispatchDescriptor<TJobType = string> {
  taskKey: string;
  taskInstanceKey: string;
  executor: string;
  jobType?: TJobType;
  jobId?: string;
}

export interface JobQueue<TJobType = string, TJobData = unknown> {
  /** Admit a job into the queue and return its id. */
  enqueue(type: TJobType, data: TJobData, options?: EnqueueOptions): Promise<string>;

  /** Cancel a single job by id. */
  cancelJob(jobId: string, reason?: string): Promise<{ status: string } | null>;

  /** Cancel every in-flight job. */
  cancelAll(reason?: string): Promise<void>;

  /** Cancel jobs scoped to a single workspace. */
  cancelByWorkspace(workspaceId: string, reason?: string): Promise<void>;

  /** Wait for all in-flight jobs to settle, up to `timeoutMs`. */
  drain(timeoutMs?: number): Promise<void>;

  getJobStatus(
    jobId: string,
    opts?: { includeBinaryResult?: boolean },
  ): Promise<QueuedJob<TJobType, TJobData> | null>;

  listJobs(opts?: { workspaceId?: string }): Promise<QueuedJob<TJobType, TJobData>[]>;

  pause(): void;
  resume(): void;

  reloadSettings(): Promise<void>;

  /**
   * Compute and dispatch the entry tasks for a workflow run.
   * Returns descriptors for the tasks that were dispatched (one per
   * fanout instance for `start/fanout` transitions).
   */
  dispatchWorkflowEntryTasks(
    params: DispatchWorkflowEntryParams,
  ): Promise<WorkflowDispatchDescriptor<TJobType>[]>;
}
