import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../../../src/db/client';
import {
  ADMIN_WORKSPACE_ID,
  executionRuns,
  jobQueue,
  workflowDefinitionTasks,
  workflowDefinitions,
  workflowRunState,
  workflowTaskResults,
  workflowTaskTransitions,
} from '../../../src/db/schema';
import { postgresJobQueue } from '../../../src/services/flow/postgres-job-queue';
import { queueManager } from '../../../src/services/queue-manager';
import { createId } from '../../../src/utils/id';
import { cleanupAuthData, createAuthenticatedUser } from '../../utils/auth-helper';

describe('PostgresJobQueue adapter', () => {
  let user: Awaited<ReturnType<typeof createAuthenticatedUser>>;

  beforeEach(async () => {
    user = await createAuthenticatedUser('editor');
  });

  afterEach(async () => {
    (queueManager as unknown as { cancelAllInProgress: boolean }).cancelAllInProgress = false;
    vi.restoreAllMocks();
    await db.delete(jobQueue).where(eq(jobQueue.workspaceId, ADMIN_WORKSPACE_ID));
    await db.delete(workflowTaskResults).where(eq(workflowTaskResults.workspaceId, user.workspaceId));
    await db.delete(workflowRunState).where(eq(workflowRunState.workspaceId, user.workspaceId));
    await db.delete(executionRuns).where(eq(executionRuns.workspaceId, user.workspaceId));
    await db.delete(workflowDefinitions).where(eq(workflowDefinitions.workspaceId, user.workspaceId));
    await cleanupAuthData();
  });

  const seedWorkflowRuntime = async () => {
    const now = new Date();
    const workflowDefinitionId = createId();
    const workflowRunId = createId();

    await db.insert(workflowDefinitions).values({
      id: workflowDefinitionId,
      workspaceId: user.workspaceId,
      key: 'job_queue_cancel_runtime_test',
      name: 'job_queue_cancel_runtime_test',
      description: 'Test workflow',
      config: {},
      sourceLevel: 'code',
      isDetached: false,
      createdByUserId: user.userId,
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(workflowDefinitionTasks).values([
      {
        id: createId(),
        workspaceId: user.workspaceId,
        workflowDefinitionId,
        taskKey: 'generation_usecase_list',
        title: 'generation_usecase_list',
        description: 'generation_usecase_list',
        orderIndex: 1,
        agentDefinitionId: null,
        metadata: { executor: 'job', jobType: 'initiative_list' },
        createdAt: now,
        updatedAt: now,
      },
      {
        id: createId(),
        workspaceId: user.workspaceId,
        workflowDefinitionId,
        taskKey: 'generation_usecase_detail',
        title: 'generation_usecase_detail',
        description: 'generation_usecase_detail',
        orderIndex: 2,
        agentDefinitionId: null,
        metadata: { executor: 'job', jobType: 'initiative_detail' },
        createdAt: now,
        updatedAt: now,
      },
    ]);

    await db.insert(workflowTaskTransitions).values({
      id: createId(),
      workspaceId: user.workspaceId,
      workflowDefinitionId,
      fromTaskKey: 'generation_usecase_list',
      toTaskKey: 'generation_usecase_detail',
      transitionType: 'conditional',
      condition: {},
      metadata: {},
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(executionRuns).values({
      id: workflowRunId,
      workspaceId: user.workspaceId,
      planId: null,
      todoId: null,
      taskId: null,
      workflowDefinitionId,
      agentDefinitionId: null,
      mode: 'full_auto',
      status: 'in_progress',
      startedByUserId: user.userId,
      startedAt: now,
      completedAt: null,
      metadata: { workflowKey: 'job_queue_cancel_runtime_test' },
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(workflowRunState).values({
      runId: workflowRunId,
      workspaceId: user.workspaceId,
      workflowDefinitionId,
      status: 'in_progress',
      state: {
        inputs: {
          folderId: 'folder-1',
        },
        generation: {
          initiatives: [
            { id: 'initiative-1', name: 'Initiative 1' },
          ],
        },
      },
      version: 1,
      currentTaskKey: 'generation_usecase_list',
      currentTaskInstanceKey: 'main',
      checkpointedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    return { workflowDefinitionId, workflowRunId };
  };

  it.each([
    'organization_batch_create',
    'matrix_generate',
    'initiative_list',
    'initiative_detail',
  ])('registers %s on the flow job runner bridge', (jobType) => {
    const deps = (queueManager as unknown as {
      getJobRunnerDeps: () => { executors: Record<string, unknown> };
    }).getJobRunnerDeps();

    expect(deps.executors[jobType]).toEqual(expect.any(Function));
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

  it('skips downstream workflow dispatch when cancellation starts before transition dispatch', async () => {
    const { workflowDefinitionId, workflowRunId } = await seedWorkflowRuntime();
    const queueManagerInternals = queueManager as unknown as {
      cancelAllInProgress: boolean;
      completeWorkflowTask: (params: Record<string, unknown>) => Promise<void>;
      getWorkflowRunContext: (runId: string) => Promise<Record<string, unknown>>;
    };
    const addJobSpy = vi
      .spyOn(queueManager, 'addJob')
      .mockRejectedValue(new Error('downstream dispatch should be skipped during cancellation'));
    const originalGetWorkflowRunContext = queueManagerInternals.getWorkflowRunContext.bind(queueManagerInternals);
    const getWorkflowRunContextSpy = vi
      .spyOn(queueManagerInternals, 'getWorkflowRunContext')
      .mockImplementation(async (runId: string) => {
        queueManagerInternals.cancelAllInProgress = true;
        return originalGetWorkflowRunContext(runId);
      });

    await expect(
      queueManagerInternals.completeWorkflowTask({
        workflow: {
          workflowRunId,
          workflowDefinitionId,
          taskKey: 'generation_usecase_list',
          agentDefinitionId: null,
          agentMap: {},
        },
        workspaceId: user.workspaceId,
        taskInstanceKey: 'main',
        jobData: {
          folderId: 'folder-1',
        },
        completion: {
          output: {
            initiativeCount: 1,
          },
          statePatch: {
            generation: {
              initiatives: [
                { id: 'initiative-1', name: 'Initiative 1' },
              ],
            },
          },
        },
      }),
    ).resolves.toBeUndefined();

    expect(getWorkflowRunContextSpy).toHaveBeenCalledWith(workflowRunId);
    expect(addJobSpy).not.toHaveBeenCalled();

    const [currentTask] = await db
      .select({
        status: workflowTaskResults.status,
      })
      .from(workflowTaskResults)
      .where(eq(workflowTaskResults.runId, workflowRunId))
      .limit(1);

    expect(currentTask?.status).toBe('completed');

    const downstreamTasks = await db
      .select({
        taskKey: workflowTaskResults.taskKey,
      })
      .from(workflowTaskResults)
      .where(eq(workflowTaskResults.runId, workflowRunId));

    expect(downstreamTasks).toEqual([
      expect.objectContaining({ taskKey: 'generation_usecase_list' }),
    ]);
  });
});
