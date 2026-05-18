import { afterEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../../../src/db/client';
import { ADMIN_WORKSPACE_ID, jobQueue } from '../../../src/db/schema';
import { postgresJobQueue } from '../../../src/services/flow/postgres-job-queue';
import { queueManager } from '../../../src/services/queue-manager';
import { createId } from '../../../src/utils/id';

describe('PostgresJobQueue adapter', () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await db.delete(jobQueue).where(eq(jobQueue.workspaceId, ADMIN_WORKSPACE_ID));
  });

  it('queueManager.cancelJob delegates cancellation to the JobQueue adapter', async () => {
    const jobId = createId();
    await db.insert(jobQueue).values({
      id: jobId,
      type: 'initiative_list',
      status: 'pending',
      workspaceId: ADMIN_WORKSPACE_ID,
      data: JSON.stringify({ folderId: 'folder-1' }),
      createdAt: new Date(),
    });
    const cancelSpy = vi.spyOn(postgresJobQueue, 'cancelJob');

    const result = await queueManager.cancelJob(jobId, 'test-cancel');

    expect(cancelSpy).toHaveBeenCalledWith(jobId, 'test-cancel');
    expect(result).toEqual({ status: 'failed' });
    const [row] = await db
      .select({ status: jobQueue.status, error: jobQueue.error })
      .from(jobQueue)
      .where(eq(jobQueue.id, jobId))
      .limit(1);
    expect(row).toMatchObject({
      status: 'failed',
      error: 'Job cancelled: test-cancel',
    });
  });

  it('queueManager.addJob delegates admission and retry metadata to the JobQueue adapter', async () => {
    const enqueueSpy = vi.spyOn(postgresJobQueue, 'enqueue');
    vi.spyOn(queueManager, 'processJobs').mockResolvedValue();

    const jobId = await queueManager.addJob(
      'initiative_list',
      { folderId: 'folder-2', organizationId: 'org-1' },
      { workspaceId: ADMIN_WORKSPACE_ID, maxRetries: 2 },
    );

    expect(enqueueSpy).toHaveBeenCalledWith(
      'initiative_list',
      { folderId: 'folder-2', organizationId: 'org-1' },
      { workspaceId: ADMIN_WORKSPACE_ID, maxRetries: 2 },
    );
    const [row] = await db
      .select({ status: jobQueue.status, data: jobQueue.data })
      .from(jobQueue)
      .where(eq(jobQueue.id, jobId))
      .limit(1);
    expect(row?.status).toBe('pending');
    expect(JSON.parse(row!.data)).toMatchObject({
      folderId: 'folder-2',
      organizationId: 'org-1',
      _retry: { attempt: 0, maxRetries: 2 },
    });
  });
});
