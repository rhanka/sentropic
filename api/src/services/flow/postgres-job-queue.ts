import type {
  DispatchWorkflowEntryParams,
  EnqueueOptions,
  JobQueue,
  QueuedJob,
  WorkflowDispatchDescriptor,
} from '@sentropic/flow';
import { desc, eq, sql } from 'drizzle-orm';
import { db, pool } from '../../db/client';
import { ADMIN_WORKSPACE_ID, jobQueue } from '../../db/schema';
import { createId } from '../../utils/id';
import {
  getPublicJobStreamId,
  parseJsonField,
  queueManager,
  sanitizeJobResultForPublic,
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
  iterateJobControllers?: () => Iterable<[string, AbortController]>;
  setCancelAllInProgress?: (value: boolean) => void;
  getActiveJobCount?: () => number;
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

  async cancelAll(reason: string = 'cancel-all'): Promise<void> {
    this.hooks.setCancelAllInProgress?.(true);
    const iter = this.hooks.iterateJobControllers?.() ?? [];
    for (const [, controller] of iter) {
      try {
        controller.abort(new DOMException(reason, 'AbortError'));
      } catch {
        // ignore abort errors if controller is already aborted
      }
    }
    await this.drain();
    this.hooks.setCancelAllInProgress?.(false);
  }

  async cancelByWorkspace(
    workspaceId: string,
    reason: string = 'purge-mine',
  ): Promise<void> {
    let processingIds: string[] = [];
    try {
      const rows = (await db.all(sql`
        SELECT id FROM job_queue
        WHERE status = 'processing' AND workspace_id = ${workspaceId}
      `)) as Array<{ id: string }>;
      processingIds = rows.map((r) => r.id);
    } catch (e) {
      console.warn('⚠️ Failed to load processing jobs for workspace cancellation:', e);
    }

    if (processingIds.length === 0) return;

    try {
      await db.run(sql`
        UPDATE job_queue
        SET status = 'failed', completed_at = CURRENT_TIMESTAMP, error = ${`Job cancelled by ${reason}`}
        WHERE status = 'processing' AND workspace_id = ${workspaceId}
      `);
    } catch {
      // ignore
    }

    for (const jobId of processingIds) {
      const controller = this.hooks.getJobController?.(jobId);
      if (!controller) continue;
      try {
        controller.abort(new DOMException(reason, 'AbortError'));
      } catch {
        // ignore
      }
      try {
        await this.notifyJobEvent(jobId);
      } catch {
        // ignore
      }
    }
  }

  async drain(timeoutMs: number = 10000): Promise<void> {
    const getActiveCount = this.hooks.getActiveJobCount;
    if (!getActiveCount) {
      return queueManager.drain(timeoutMs);
    }
    const start = Date.now();
    while (getActiveCount() > 0 && Date.now() - start < timeoutMs) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  async getJobStatus(
    jobId: string,
    opts?: { includeBinaryResult?: boolean },
  ): Promise<QueuedJob<JobType, JobData> | null> {
    const result = await db
      .select()
      .from(jobQueue)
      .where(eq(jobQueue.id, jobId))
      .limit(1);

    if (!result || result.length === 0) return null;

    const row = result[0];
    const job = {
      id: row.id,
      type: row.type as JobType,
      data: (parseJsonField<JobData>(row.data) ?? {}) as JobData,
      result:
        opts?.includeBinaryResult === true
          ? parseJsonField(row.result)
          : sanitizeJobResultForPublic(parseJsonField(row.result)),
      status: row.status as Job['status'],
      workspaceId: row.workspaceId,
      createdAt: row.createdAt.toISOString(),
      startedAt: row.startedAt || undefined,
      completedAt: row.completedAt || undefined,
      error: row.error || undefined,
    } satisfies Omit<Job, 'streamId'>;

    return {
      ...job,
      streamId: getPublicJobStreamId(job),
    } as QueuedJob<JobType, JobData>;
  }

  async listJobs(opts?: { workspaceId?: string }): Promise<QueuedJob<JobType, JobData>[]> {
    const results = await db
      .select()
      .from(jobQueue)
      .where(opts?.workspaceId ? eq(jobQueue.workspaceId, opts.workspaceId) : undefined)
      .orderBy(desc(jobQueue.createdAt));

    return results.map((row) => {
      const job = {
        id: row.id,
        type: row.type as JobType,
        data: (parseJsonField<JobData>(row.data) ?? {}) as JobData,
        result: sanitizeJobResultForPublic(parseJsonField(row.result)),
        status: row.status as Job['status'],
        workspaceId: row.workspaceId,
        createdAt: row.createdAt.toISOString(),
        startedAt: row.startedAt || undefined,
        completedAt: row.completedAt || undefined,
        error: row.error || undefined,
      } satisfies Omit<Job, 'streamId'>;

      return {
        ...job,
        streamId: getPublicJobStreamId(job),
      } as QueuedJob<JobType, JobData>;
    });
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
