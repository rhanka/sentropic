import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db } from '../../src/db/client';
import {
  executionRuns,
  workflowDefinitionTasks,
  workflowDefinitions,
  workflowRunState,
  workflowTaskResults,
  workflowTaskTransitions,
} from '../../src/db/schema';
import { createId } from '../../src/utils/id';
import { cleanupAuthData, createAuthenticatedUser } from '../utils/auth-helper';

async function importQueueManager() {
  const mod = await import('../../src/services/queue-manager');
  return mod.queueManager as any;
}

type TestTaskSeed = {
  taskKey: string;
  orderIndex: number;
  metadata: Record<string, unknown>;
};

type TestTransitionSeed = {
  fromTaskKey: string | null;
  toTaskKey: string | null;
  transitionType: string;
  condition?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

describe('Queue - generic workflow transition runtime', () => {
  let queueManager: any;
  let user: Awaited<ReturnType<typeof createAuthenticatedUser>>;

  beforeEach(async () => {
    queueManager = await importQueueManager();
    user = await createAuthenticatedUser('editor');
  });

  afterEach(async () => {
    await db.delete(workflowTaskResults).where(eq(workflowTaskResults.workspaceId, user.workspaceId));
    await db.delete(workflowRunState).where(eq(workflowRunState.workspaceId, user.workspaceId));
    await db.delete(executionRuns).where(eq(executionRuns.workspaceId, user.workspaceId));
    await db.delete(workflowDefinitions).where(eq(workflowDefinitions.workspaceId, user.workspaceId));
    await cleanupAuthData();
    vi.restoreAllMocks();
  });

  const seedWorkflowRuntime = async (params: {
    workflowKey: string;
    state: Record<string, unknown>;
    tasks: TestTaskSeed[];
    transitions: TestTransitionSeed[];
  }) => {
    const now = new Date();
    const workflowDefinitionId = createId();
    const workflowRunId = createId();

    await db.insert(workflowDefinitions).values({
      id: workflowDefinitionId,
      workspaceId: user.workspaceId,
      key: params.workflowKey,
      name: params.workflowKey,
      description: 'Test workflow',
      config: {},
      sourceLevel: 'code',
      isDetached: false,
      createdByUserId: user.userId,
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(workflowDefinitionTasks).values(
      params.tasks.map((task) => ({
        id: createId(),
        workspaceId: user.workspaceId,
        workflowDefinitionId,
        taskKey: task.taskKey,
        title: task.taskKey,
        description: task.taskKey,
        orderIndex: task.orderIndex,
        agentDefinitionId: null,
        metadata: task.metadata,
        createdAt: now,
        updatedAt: now,
      })),
    );

    await db.insert(workflowTaskTransitions).values(
      params.transitions.map((transition) => ({
        id: createId(),
        workspaceId: user.workspaceId,
        workflowDefinitionId,
        fromTaskKey: transition.fromTaskKey,
        toTaskKey: transition.toTaskKey,
        transitionType: transition.transitionType,
        condition: transition.condition ?? {},
        metadata: transition.metadata ?? {},
        createdAt: now,
        updatedAt: now,
      })),
    );

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
      metadata: { workflowKey: params.workflowKey },
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(workflowRunState).values({
      runId: workflowRunId,
      workspaceId: user.workspaceId,
      workflowDefinitionId,
      status: 'in_progress',
      state: params.state,
      version: 1,
      currentTaskKey: null,
      currentTaskInstanceKey: 'main',
      checkpointedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    return { workflowDefinitionId, workflowRunId };
  };

  it('dispatches conditional entry transitions without workflow-specific routing code', async () => {
    const { workflowDefinitionId, workflowRunId } = await seedWorkflowRuntime({
      workflowKey: 'conditional_runtime_test',
      state: {
        routing: {
          variant: 'with_orgs',
        },
      },
      tasks: [
        {
          taskKey: 'context_prepare',
          orderIndex: 1,
          metadata: { executor: 'noop' },
        },
        {
          taskKey: 'list_default',
          orderIndex: 2,
          metadata: { executor: 'job', jobType: 'initiative_list' },
        },
        {
          taskKey: 'list_with_orgs',
          orderIndex: 3,
          metadata: { executor: 'job', jobType: 'initiative_list' },
        },
      ],
      transitions: [
        { fromTaskKey: null, toTaskKey: 'context_prepare', transitionType: 'start' },
        {
          fromTaskKey: 'context_prepare',
          toTaskKey: 'list_with_orgs',
          transitionType: 'conditional',
          condition: { path: 'routing.variant', operator: 'eq', value: 'with_orgs' },
        },
        {
          fromTaskKey: 'context_prepare',
          toTaskKey: 'list_default',
          transitionType: 'conditional',
          condition: { path: 'routing.variant', operator: 'eq', value: 'default' },
        },
      ],
    });

    const addJobSpy = vi.spyOn(queueManager, 'addJob').mockResolvedValue(createId());

    const dispatched = await queueManager.dispatchWorkflowEntryTasks({
      workspaceId: user.workspaceId,
      workflowRunId,
      workflowDefinitionId,
    });

    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]).toMatchObject({
      taskKey: 'list_with_orgs',
      taskInstanceKey: 'main',
      executor: 'job',
      jobType: 'initiative_list',
    });
    expect(addJobSpy).toHaveBeenCalledTimes(1);
    expect(addJobSpy).toHaveBeenCalledWith(
      'initiative_list',
      expect.objectContaining({
        workflow: expect.objectContaining({
          workflowRunId,
          workflowDefinitionId,
          taskKey: 'list_with_orgs',
        }),
      }),
      expect.objectContaining({ workspaceId: user.workspaceId, maxRetries: 1 }),
    );
  });

  it('schedules fanout items from transition metadata only', async () => {
    const { workflowDefinitionId, workflowRunId } = await seedWorkflowRuntime({
      workflowKey: 'fanout_runtime_test',
      state: {
        inputs: {
          folderId: 'folder-1',
          matrixMode: 'default',
          model: 'gpt-4.1-nano',
          locale: 'fr',
        },
        generation: {
          initiatives: [],
        },
      },
      tasks: [
        {
          taskKey: 'generation_usecase_detail',
          orderIndex: 2,
          metadata: {
            executor: 'job',
            jobType: 'initiative_detail',
            inputBindings: {
              initiativeId: '$item.id',
              initiativeName: '$item.name',
              folderId: '$state.inputs.folderId',
              matrixMode: '$state.inputs.matrixMode',
              model: '$state.inputs.model',
              initiatedByUserId: '$run.startedByUserId',
              locale: '$state.inputs.locale',
            },
          },
        },
      ],
      transitions: [
        {
          fromTaskKey: 'generation_usecase_list',
          toTaskKey: 'generation_usecase_detail',
          transitionType: 'fanout',
          metadata: {
            fanout: {
              sourcePath: 'generation.initiatives',
            },
          },
        },
      ],
    });

    const addJobSpy = vi
      .spyOn(queueManager, 'addJob')
      .mockResolvedValueOnce(createId())
      .mockResolvedValueOnce(createId());

    await (queueManager as {
      completeWorkflowTask: (params: Record<string, unknown>) => Promise<void>;
    }).completeWorkflowTask({
      workflow: {
        workflowRunId,
        workflowDefinitionId,
        taskKey: 'generation_usecase_list',
        agentDefinitionId: null,
        agentMap: {},
      },
      workspaceId: user.workspaceId,
      taskInstanceKey: 'main',
      jobData: {},
      completion: {
        output: {
          initiativeCount: 2,
        },
        statePatch: {
          generation: {
            initiatives: [
              { id: 'initiative-1', name: 'Initiative 1' },
              { id: 'initiative-2', name: 'Initiative 2' },
            ],
          },
        },
      },
    });

    expect(addJobSpy).toHaveBeenCalledTimes(2);
    expect(addJobSpy).toHaveBeenNthCalledWith(
      1,
      'initiative_detail',
      expect.objectContaining({
        initiativeId: 'initiative-1',
        initiativeName: 'Initiative 1',
        folderId: 'folder-1',
        workflow: expect.objectContaining({
          taskKey: 'generation_usecase_detail',
        }),
      }),
      expect.objectContaining({ workspaceId: user.workspaceId, maxRetries: 1 }),
    );
    expect(addJobSpy).toHaveBeenNthCalledWith(
      2,
      'initiative_detail',
      expect.objectContaining({
        initiativeId: 'initiative-2',
        initiativeName: 'Initiative 2',
        folderId: 'folder-1',
      }),
      expect.objectContaining({ workspaceId: user.workspaceId, maxRetries: 1 }),
    );

    const detailTaskResults = await db
      .select({
        taskInstanceKey: workflowTaskResults.taskInstanceKey,
        status: workflowTaskResults.status,
      })
      .from(workflowTaskResults)
      .where(
        and(
          eq(workflowTaskResults.runId, workflowRunId),
          eq(workflowTaskResults.taskKey, 'generation_usecase_detail'),
        ),
      );

    expect(detailTaskResults).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ taskInstanceKey: 'initiative-1', status: 'pending' }),
        expect.objectContaining({ taskInstanceKey: 'initiative-2', status: 'pending' }),
      ]),
    );
  });

  it('dispatches join targets only after all expected fanout tasks complete', async () => {
    const { workflowDefinitionId, workflowRunId } = await seedWorkflowRuntime({
      workflowKey: 'join_runtime_test',
      state: {
        inputs: {
          folderId: 'folder-join',
          model: 'gpt-4.1-nano',
          locale: 'fr',
        },
        generation: {
          initiatives: [
            { id: 'initiative-1', name: 'Initiative 1' },
            { id: 'initiative-2', name: 'Initiative 2' },
          ],
        },
      },
      tasks: [
        {
          taskKey: 'generation_executive_summary',
          orderIndex: 3,
          metadata: {
            executor: 'job',
            jobType: 'executive_summary',
            inputBindings: {
              folderId: '$state.inputs.folderId',
              model: '$state.inputs.model',
              initiatedByUserId: '$run.startedByUserId',
              locale: '$state.inputs.locale',
            },
          },
        },
      ],
      transitions: [
        {
          fromTaskKey: 'generation_usecase_detail',
          toTaskKey: 'generation_executive_summary',
          transitionType: 'join',
          metadata: {
            join: {
              taskKey: 'generation_usecase_detail',
              mode: 'all',
              expectedSourcePath: 'generation.initiatives',
            },
          },
        },
      ],
    });

    const addJobSpy = vi.spyOn(queueManager, 'addJob').mockResolvedValue(createId());

    const completeDetail = async (taskInstanceKey: string) => {
      await (queueManager as {
        completeWorkflowTask: (params: Record<string, unknown>) => Promise<void>;
      }).completeWorkflowTask({
        workflow: {
          workflowRunId,
          workflowDefinitionId,
          taskKey: 'generation_usecase_detail',
          agentDefinitionId: null,
          agentMap: {},
        },
        workspaceId: user.workspaceId,
        taskInstanceKey,
        jobData: {
          initiativeId: taskInstanceKey,
        },
        completion: {
          output: {
            initiativeId: taskInstanceKey,
          },
        },
      });
    };

    await completeDetail('initiative-1');
    expect(addJobSpy).not.toHaveBeenCalled();

    await completeDetail('initiative-2');
    expect(addJobSpy).toHaveBeenCalledTimes(1);
    expect(addJobSpy).toHaveBeenCalledWith(
      'executive_summary',
      expect.objectContaining({
        folderId: 'folder-join',
        workflow: expect.objectContaining({
          taskKey: 'generation_executive_summary',
        }),
      }),
      expect.objectContaining({ workspaceId: user.workspaceId, maxRetries: 1 }),
    );
  });

  it('does not duplicate join dispatch when a completed fanout task is replayed', async () => {
    const { workflowDefinitionId, workflowRunId } = await seedWorkflowRuntime({
      workflowKey: 'join_replay_runtime_test',
      state: {
        inputs: {
          folderId: 'folder-replay',
          model: 'gpt-4.1-nano',
          locale: 'fr',
        },
        generation: {
          initiatives: [
            { id: 'initiative-1', name: 'Initiative 1' },
            { id: 'initiative-2', name: 'Initiative 2' },
          ],
        },
      },
      tasks: [
        {
          taskKey: 'generation_executive_summary',
          orderIndex: 3,
          metadata: {
            executor: 'job',
            jobType: 'executive_summary',
            inputBindings: {
              folderId: '$state.inputs.folderId',
              model: '$state.inputs.model',
              initiatedByUserId: '$run.startedByUserId',
              locale: '$state.inputs.locale',
            },
          },
        },
      ],
      transitions: [
        {
          fromTaskKey: 'generation_usecase_detail',
          toTaskKey: 'generation_executive_summary',
          transitionType: 'join',
          metadata: {
            join: {
              taskKey: 'generation_usecase_detail',
              mode: 'all',
              expectedSourcePath: 'generation.initiatives',
            },
          },
        },
      ],
    });

    const addJobSpy = vi.spyOn(queueManager, 'addJob').mockResolvedValue(createId());

    const completeDetail = async (taskInstanceKey: string) => {
      await (queueManager as {
        completeWorkflowTask: (params: Record<string, unknown>) => Promise<void>;
      }).completeWorkflowTask({
        workflow: {
          workflowRunId,
          workflowDefinitionId,
          taskKey: 'generation_usecase_detail',
          agentDefinitionId: null,
          agentMap: {},
        },
        workspaceId: user.workspaceId,
        taskInstanceKey,
        jobData: {
          initiativeId: taskInstanceKey,
        },
        completion: {
          output: {
            initiativeId: taskInstanceKey,
          },
        },
      });
    };

    await completeDetail('initiative-1');
    await completeDetail('initiative-2');
    await completeDetail('initiative-2');

    expect(addJobSpy).toHaveBeenCalledTimes(1);

    const [summaryTaskResult] = await db
      .select({
        status: workflowTaskResults.status,
      })
      .from(workflowTaskResults)
      .where(
        and(
          eq(workflowTaskResults.runId, workflowRunId),
          eq(workflowTaskResults.taskKey, 'generation_executive_summary'),
          eq(workflowTaskResults.taskInstanceKey, 'main'),
        ),
      )
      .limit(1);

    expect(summaryTaskResult?.status).toBe('pending');
  });
});
