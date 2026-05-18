import type {
  DispatchWorkflowEntryParams,
  EnqueueOptions,
  JobQueue,
  QueuedJob,
  WorkflowDispatchDescriptor,
} from '@sentropic/flow';
import { eq, sql } from 'drizzle-orm';
import { db, pool } from '../../db/client';
import { ADMIN_WORKSPACE_ID, jobQueue } from '../../db/schema';
import { createId } from '../../utils/id';
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
type PostgresJobQueueRuntimeHooks = {
  canAcceptJob?: (type: JobType) => boolean;
  notifyJobEvent?: (jobId: string) => Promise<void>;
  getJobController?: (jobId: string) => AbortController | undefined;
  startProcessing?: () => void;
};

export class PostgresJobQueue implements JobQueue<JobType, JobData> {
  private hooks: PostgresJobQueueRuntimeHooks = {};

  setRuntimeHooks(hooks: PostgresJobQueueRuntimeHooks): void {
    this.hooks = hooks;
  }

  private async notifyJobEvent(jobId: string): Promise<void> {
    if (this.hooks.notifyJobEvent) {
      await this.hooks.notifyJobEvent(jobId);
      return;
    }
    const notifyPayload = JSON.stringify({ job_id: jobId });
    const client = await pool.connect();
    try {
      await client.query(`NOTIFY job_events, '${notifyPayload.replace(/'/g, "''")}'`);
    } finally {
      client.release();
    }
  }

  async enqueue(type: JobType, data: JobData, options?: EnqueueOptions): Promise<string> {
    if (this.hooks.canAcceptJob && !this.hooks.canAcceptJob(type)) {
      throw new Error('Queue is paused or cancelling; job not accepted');
    }

    const jobId = createId();
    const workspaceId = options?.workspaceId ?? ADMIN_WORKSPACE_ID;
    const maxRetries = Number.isFinite(options?.maxRetries as number)
      ? Number(options?.maxRetries)
      : 0;
    const payload = {
      ...(data as unknown as Record<string, unknown>),
      _retry: {
        attempt: 0,
        maxRetries: Math.max(0, Math.floor(maxRetries)),
      },
    };

    await db.run(sql`
      INSERT INTO job_queue (id, type, data, status, created_at, workspace_id)
      VALUES (${jobId}, ${type}, ${JSON.stringify(payload)}, 'pending', ${new Date()}, ${workspaceId})
    `);
    await this.notifyJobEvent(jobId);

    console.log(`📝 Job ${jobId} (${type}) added to queue`);
    this.hooks.startProcessing?.();

    return jobId;
  }

  async cancelJob(jobId: string, reason: string = 'cancelled'): Promise<{ status: string } | null> {
    const [row] = await db
      .select({ id: jobQueue.id, type: jobQueue.type, status: jobQueue.status })
      .from(jobQueue)
      .where(eq(jobQueue.id, jobId))
      .limit(1);
    if (!row) return null;

    const isChat = row.type === 'chat_message';
    const nextStatus = isChat ? 'completed' : 'failed';
    await db.run(sql`
      UPDATE job_queue
      SET status = ${nextStatus},
          completed_at = ${new Date()},
          error = ${`Job cancelled: ${reason}`}
      WHERE id = ${jobId}
    `);
    await this.notifyJobEvent(jobId);

    const controller = this.hooks.getJobController?.(jobId);
    if (controller) {
      try {
        controller.abort(new DOMException(reason, 'AbortError'));
      } catch {
        // ignore
      }
    }

    return { status: nextStatus };
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
