import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runJob } from '@sentropic/flow';
import { eq } from 'drizzle-orm';
import { db } from '../../../src/db/client';
import {
  ADMIN_WORKSPACE_ID,
  contextDocuments,
  executionRuns,
  jobQueue,
  workflowDefinitionTasks,
  workflowDefinitions,
  workflowRunState,
  workflowTaskResults,
  workflowTaskTransitions,
} from '../../../src/db/schema';
import { postgresJobQueue } from '../../../src/services/flow/postgres-job-queue';
import { chatService } from '../../../src/services/chat-service';
import { queueManager } from '../../../src/services/queue-manager';
import { createId } from '../../../src/utils/id';
import { cleanupAuthData, createAuthenticatedUser } from '../../utils/auth-helper';

const streamEvents: Array<{ streamId: string; eventType: string; data: unknown; sequence: number }> = [];
let seqByStream = new Map<string, number>();
vi.mock('../../../src/services/stream-service', async () => ({
  getNextSequence: async (streamId: string) => {
    const next = (seqByStream.get(streamId) ?? 0) + 1;
    seqByStream.set(streamId, next);
    return next;
  },
  writeStreamEvent: async (streamId: string, eventType: string, data: unknown, sequence: number) => {
    streamEvents.push({ streamId, eventType, data, sequence });
  },
}));

describe('PostgresJobQueue adapter', () => {
  let user: Awaited<ReturnType<typeof createAuthenticatedUser>>;

  beforeEach(async () => {
    streamEvents.length = 0;
    seqByStream = new Map<string, number>();
    user = await createAuthenticatedUser('editor');
  });

  afterEach(async () => {
    (queueManager as unknown as { cancelAllInProgress: boolean }).cancelAllInProgress = false;
    vi.restoreAllMocks();
    await db.delete(jobQueue).where(eq(jobQueue.workspaceId, ADMIN_WORKSPACE_ID));
    await db.delete(contextDocuments).where(eq(contextDocuments.contextId, 'job-queue-terminal-failure-test'));
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
    'organization_enrich',
    'docx_generate',
    'chat_message',
    'document_summary',
  ])('registers %s on the flow job runner bridge', (jobType) => {
    const deps = (queueManager as unknown as {
      getJobRunnerDeps: () => { executors: Record<string, unknown> };
    }).getJobRunnerDeps();

    expect(deps.executors[jobType]).toEqual(expect.any(Function));
  });

  it('passes job identity context to migrated executor bindings', async () => {
    const executor = vi.fn().mockResolvedValue(undefined);
    const row = {
      id: 'job-context-test',
      type: 'docx_generate',
      workspaceId: 'workspace-context-test',
      data: JSON.stringify({ templateId: 'usecase-onepage' }),
    };

    await runJob(row, {
      parseJobData: (jobRow: typeof row) => JSON.parse(jobRow.data),
      getJobId: (jobRow: typeof row) => jobRow.id,
      getJobType: (jobRow: typeof row) => jobRow.type,
      getWorkspaceId: (jobRow: typeof row) => jobRow.workspaceId,
      getWorkflowContext: () => null,
      getWorkflowTaskInstanceKey: () => 'main',
      buildRetryJobData: (data: unknown) => data,
      claimReadStatus: async () => 'processing',
      registerController: vi.fn(),
      unregisterController: vi.fn(),
      markWorkflowTaskStarted: vi.fn(),
      completeWorkflowTask: vi.fn(),
      failWorkflowTask: vi.fn(),
      upsertWorkflowTaskResultForRetry: vi.fn(),
      markJobCompleted: vi.fn(),
      markJobFailed: vi.fn(),
      requeueJobForRetry: vi.fn(),
      notifyJobEvent: vi.fn(),
      executors: {
        docx_generate: executor,
      },
      onAbortedCancellation: async () => false,
      onTerminalFailure: vi.fn(),
    } as any);

    expect(executor).toHaveBeenCalledWith(
      { templateId: 'usecase-onepage' },
      expect.any(AbortSignal),
      expect.objectContaining({
        jobId: 'job-context-test',
        jobType: 'docx_generate',
        workspaceId: 'workspace-context-test',
      }),
    );
  });

  it('handles aborted chat_message cancellation through the flow job runner hook', async () => {
    const jobId = createId();
    const assistantMessageId = createId();
    await db.insert(jobQueue).values({
      id: jobId,
      type: 'chat_message',
      status: 'processing',
      workspaceId: ADMIN_WORKSPACE_ID,
      data: JSON.stringify({ assistantMessageId }),
      createdAt: new Date(),
    });
    const finalizeSpy = vi
      .spyOn(chatService, 'finalizeAssistantMessageFromStream')
      .mockResolvedValue({ content: 'partial', reasoning: null, wroteDone: true });
    const deps = (queueManager as unknown as {
      getJobRunnerDeps: () => {
        onAbortedCancellation: (row: unknown, error: unknown, jobData: unknown) => Promise<boolean>;
      };
    }).getJobRunnerDeps();

    const handled = await deps.onAbortedCancellation(
      {
        id: jobId,
        type: 'chat_message',
        workspaceId: ADMIN_WORKSPACE_ID,
        data: JSON.stringify({ assistantMessageId }),
      },
      new DOMException('Request was aborted', 'AbortError'),
      { assistantMessageId },
    );

    expect(handled).toBe(true);
    expect(finalizeSpy).toHaveBeenCalledWith({
      assistantMessageId,
      reason: 'Request was aborted',
      fallbackContent: 'Réponse interrompue.',
    });
    const [row] = await db
      .select({ status: jobQueue.status, error: jobQueue.error })
      .from(jobQueue)
      .where(eq(jobQueue.id, jobId))
      .limit(1);
    expect(row).toMatchObject({
      status: 'completed',
      error: 'Request was aborted',
    });
  });

  it('mirrors document_summary terminal failures through the flow job runner hook', async () => {
    const documentId = createId();
    await db.insert(contextDocuments).values({
      id: documentId,
      workspaceId: ADMIN_WORKSPACE_ID,
      contextType: 'organization',
      contextId: 'job-queue-terminal-failure-test',
      filename: 'failure.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 42,
      sourceType: 'local',
      storageKey: 'documents/failure.pdf',
      status: 'processing',
      data: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const deps = (queueManager as unknown as {
      getJobRunnerDeps: () => {
        onTerminalFailure: (row: unknown, error: unknown, jobData: unknown) => Promise<void>;
      };
    }).getJobRunnerDeps();

    await deps.onTerminalFailure(
      {
        id: createId(),
        type: 'document_summary',
        workspaceId: ADMIN_WORKSPACE_ID,
        data: JSON.stringify({ documentId }),
      },
      new Error('Summarizer exploded'),
      { documentId },
    );

    const [doc] = await db
      .select({ status: contextDocuments.status, data: contextDocuments.data })
      .from(contextDocuments)
      .where(eq(contextDocuments.id, documentId))
      .limit(1);
    expect(doc).toMatchObject({
      status: 'failed',
      data: expect.objectContaining({ summary: 'Échec: Summarizer exploded' }),
    });
    expect(streamEvents).toContainEqual({
      streamId: `document_${documentId}`,
      eventType: 'error',
      data: { message: 'Summarizer exploded' },
      sequence: 1,
    });
  });

  it('claims pending jobs by queue class through the JobQueue adapter', async () => {
    const chatJobId = createId();
    const publishingJobId = createId();
    const aiJobId = createId();
    await db.insert(jobQueue).values([
      {
        id: chatJobId,
        type: 'chat_message',
        status: 'pending',
        workspaceId: ADMIN_WORKSPACE_ID,
        data: JSON.stringify({ assistantMessageId: createId() }),
        createdAt: new Date(),
      },
      {
        id: publishingJobId,
        type: 'docx_generate',
        status: 'pending',
        workspaceId: ADMIN_WORKSPACE_ID,
        data: JSON.stringify({ templateId: 'usecase-onepage' }),
        createdAt: new Date(),
      },
      {
        id: aiJobId,
        type: 'initiative_list',
        status: 'pending',
        workspaceId: ADMIN_WORKSPACE_ID,
        data: JSON.stringify({ folderId: createId(), matrix: [] }),
        createdAt: new Date(),
      },
    ]);

    const [chatJob] = await postgresJobQueue.claimPendingJobsByClass('chat', 1);
    const [publishingJob] = await postgresJobQueue.claimPendingJobsByClass('publishing', 1);
    const [aiJob] = await postgresJobQueue.claimPendingJobsByClass('ai', 1);

    expect(chatJob?.id).toBe(chatJobId);
    expect(publishingJob?.id).toBe(publishingJobId);
    expect(aiJob?.id).toBe(aiJobId);
    await expect(postgresJobQueue.getProcessingCountByClass('chat')).resolves.toBe(1);
    await expect(postgresJobQueue.getProcessingCountByClass('publishing')).resolves.toBe(1);
    await expect(postgresJobQueue.getProcessingCountByClass('ai')).resolves.toBe(1);
    await expect(postgresJobQueue.hasAnyPending()).resolves.toBe(false);
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
