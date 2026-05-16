import type {
  DispatchWorkflowEntryParams,
  EnqueueOptions,
  JobQueue,
  QueuedJob,
  WorkflowDispatchDescriptor,
} from '@sentropic/flow';
import {
  queueManager,
  type Job,
  type JobData,
  type JobType,
} from '../queue-manager';

/**
 * Postgres-backed `JobQueue` adapter.
 *
 * Lot 3 contract: every method delegates to the matching public
 * method of the `queueManager` singleton. No logic moved.
 *
 * The `JobType` and `JobData` unions are app-specific (organization_*,
 * matrix_generate, initiative_*, executive_summary, chat_message,
 * document_summary, docx_generate). The package keeps them as generic
 * parameters so future consumers can plug their own executor catalog.
 *
 * Per spec/SPEC_EVOL_BR26_FLOW_FACADE.md §3.
 */
export class PostgresJobQueue implements JobQueue<JobType, JobData> {
  enqueue(type: JobType, data: JobData, options?: EnqueueOptions): Promise<string> {
    return queueManager.addJob(type, data, options);
  }

  cancelJob(jobId: string, reason?: string): Promise<{ status: string } | null> {
    return queueManager.cancelJob(jobId, reason);
  }

  cancelAll(reason?: string): Promise<void> {
    return queueManager.cancelAllProcessing(reason);
  }

  cancelByWorkspace(workspaceId: string, reason?: string): Promise<void> {
    return queueManager.cancelProcessingForWorkspace(workspaceId, reason);
  }

  drain(timeoutMs?: number): Promise<void> {
    return queueManager.drain(timeoutMs);
  }

  getJobStatus(
    jobId: string,
    opts?: { includeBinaryResult?: boolean },
  ): Promise<QueuedJob<JobType, JobData> | null> {
    return queueManager.getJobStatus(jobId, opts) as Promise<
      QueuedJob<JobType, JobData> | null
    >;
  }

  listJobs(opts?: { workspaceId?: string }): Promise<QueuedJob<JobType, JobData>[]> {
    return queueManager.getAllJobs(opts) as Promise<QueuedJob<JobType, JobData>[]>;
  }

  pause(): void {
    queueManager.pause();
  }

  resume(): void {
    queueManager.resume();
  }

  reloadSettings(): Promise<void> {
    return queueManager.reloadSettings();
  }

  dispatchWorkflowEntryTasks(
    params: DispatchWorkflowEntryParams,
  ): Promise<WorkflowDispatchDescriptor<JobType>[]> {
    return queueManager.dispatchWorkflowEntryTasks(params) as Promise<
      WorkflowDispatchDescriptor<JobType>[]
    >;
  }
}

// Type-narrowing assertions: the `Job` row from queue-manager and the
// `QueuedJob` envelope from the package must be assignment-compatible.
// Reference Job to keep the import live (the cast above guarantees the
// runtime shape matches the package interface).
const _shapeAssertion: ReadonlyArray<keyof Job> = [
  'id',
  'type',
  'data',
  'streamId',
  'status',
  'createdAt',
];
void _shapeAssertion;

export const postgresJobQueue = new PostgresJobQueue();
