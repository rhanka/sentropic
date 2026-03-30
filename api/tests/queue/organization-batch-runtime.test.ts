import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db } from '../../src/db/client';
import {
  executionRuns,
  folders,
  jobQueue,
  organizations,
  workflowDefinitionTasks,
  workflowDefinitions,
  workflowRunState,
  workflowTaskTransitions,
  workflowTaskResults,
} from '../../src/db/schema';
import { createId } from '../../src/utils/id';
import { createAuthenticatedUser, cleanupAuthData } from '../utils/auth-helper';

const mockExecuteWithToolsStream = vi.fn();
vi.mock('../../src/services/tools', async () => {
  return {
    executeWithToolsStream: (prompt: string, options: Record<string, unknown>) =>
      mockExecuteWithToolsStream(prompt, options),
  };
});

async function importQueueManager() {
  const mod = await import('../../src/services/queue-manager');
  return mod.queueManager as any;
}

describe('Queue - organization_batch_create runtime', () => {
  let queueManager: any;
  let user: Awaited<ReturnType<typeof createAuthenticatedUser>>;

  beforeEach(async () => {
    queueManager = await importQueueManager();
    user = await createAuthenticatedUser('editor');
    mockExecuteWithToolsStream.mockReset();
  });

  afterEach(async () => {
    await db.delete(workflowTaskResults).where(eq(workflowTaskResults.workspaceId, user.workspaceId));
    await db.delete(workflowRunState).where(eq(workflowRunState.workspaceId, user.workspaceId));
    await db.delete(executionRuns).where(eq(executionRuns.workspaceId, user.workspaceId));
    await db.delete(jobQueue).where(eq(jobQueue.workspaceId, user.workspaceId));
    await db.delete(folders).where(eq(folders.workspaceId, user.workspaceId));
    await db.delete(organizations).where(eq(organizations.workspaceId, user.workspaceId));
    await db.delete(workflowDefinitions).where(eq(workflowDefinitions.workspaceId, user.workspaceId));
    await cleanupAuthData();
    vi.restoreAllMocks();
  });

  it('creates organizations, updates workflow runtime state, and enqueues initiative_list', async () => {
    const folderId = createId();
    const workflowDefinitionId = createId();
    const workflowRunId = createId();
    const jobId = createId();
    const existingOrganizationId = createId();
    const enqueuedListJobId = createId();
    const now = new Date();

    await db.insert(organizations).values({
      id: existingOrganizationId,
      workspaceId: user.workspaceId,
      name: 'Existing Org',
      status: 'completed',
      data: {
        industry: 'Tech',
        size: '',
        products: '',
        processes: '',
        kpis: '',
        challenges: '',
        objectives: 'Existing profile',
        technologies: '',
        references: [],
      },
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(folders).values({
      id: folderId,
      workspaceId: user.workspaceId,
      name: 'Folder',
      description: 'Need organizations',
      organizationId: null,
      matrixConfig: null,
      status: 'generating',
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(workflowDefinitions).values({
      id: workflowDefinitionId,
      workspaceId: user.workspaceId,
      key: 'ai_usecase_generation_v1',
      name: 'Workflow',
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
        taskKey: 'generation_create_organizations',
        title: 'Create organizations',
        description: 'Create organizations before list generation',
        orderIndex: 1,
        agentDefinitionId: null,
        metadata: {
          executor: 'job',
          jobType: 'organization_batch_create',
        },
        createdAt: now,
        updatedAt: now,
      },
      {
        id: createId(),
        workspaceId: user.workspaceId,
        workflowDefinitionId,
        taskKey: 'generation_usecase_list',
        title: 'Use-case list generation',
        description: 'Generate initiatives from the resolved organization context',
        orderIndex: 2,
        agentDefinitionId: null,
        metadata: {
          executor: 'job',
          jobType: 'initiative_list',
          inputBindings: {
            folderId: '$state.inputs.folderId',
            input: '$state.inputs.input',
            organizationId: '$state.inputs.organizationId',
            matrixMode: '$state.inputs.matrixMode',
            model: '$state.inputs.model',
            initiativeCount: '$state.inputs.initiativeCount',
            initiatedByUserId: '$run.startedByUserId',
            locale: '$state.inputs.locale',
            orgIds: '$state.orgContext.effectiveOrgIds',
          },
        },
        createdAt: now,
        updatedAt: now,
      },
    ]);

    await db.insert(workflowTaskTransitions).values({
      id: createId(),
      workspaceId: user.workspaceId,
      workflowDefinitionId,
      fromTaskKey: 'generation_create_organizations',
      toTaskKey: 'generation_usecase_list',
      transitionType: 'normal',
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
      metadata: {},
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
          folderId,
          input: 'Generate initiatives for retail and existing players',
          matrixMode: 'default',
          initiativeCount: 2,
          locale: 'fr',
          organizationId: null,
          model: 'gpt-4.1-nano',
        },
        orgContext: {
          selectedOrgIds: [],
          createdOrgIds: [],
          createdOrganizations: [],
        },
        generation: {
          initiativeIds: [],
        },
      },
      version: 1,
      currentTaskKey: 'generation_create_organizations',
      currentTaskInstanceKey: 'main',
      checkpointedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(jobQueue).values({
      id: jobId,
      type: 'organization_batch_create',
      status: 'processing',
      workspaceId: user.workspaceId,
      data: JSON.stringify({
        folderId,
        input: 'Generate initiatives for retail and existing players',
        model: 'gpt-4.1-nano',
        locale: 'fr',
        workflow: {
          workflowRunId,
          workflowDefinitionId,
          taskKey: 'generation_create_organizations',
          agentDefinitionId: null,
          agentMap: {
            generation_usecase_list: 'agent_list_with_orgs',
            generation_create_organizations: 'agent_batch',
          },
        },
        _retry: {
          attempt: 0,
          maxRetries: 1,
        },
      }),
      createdAt: now,
      startedAt: now,
    });

    mockExecuteWithToolsStream.mockResolvedValue({
      streamId: `folder_${folderId}`,
      content: JSON.stringify({
        organizations: [
          {
            name: 'Existing Org',
            sector: 'Technology',
            description: 'Already in workspace',
            location: 'Montreal, Canada',
          },
          {
            name: 'New Retail Org',
            sector: 'Retail',
            description: 'Retail organization to include in the initiative generation scope.',
            location: 'Paris, France',
          },
        ],
      }),
    });

    const addJobSpy = vi.spyOn(queueManager, 'addJob').mockResolvedValue(enqueuedListJobId);

    const [job] = await db
      .select()
      .from(jobQueue)
      .where(and(eq(jobQueue.id, jobId), eq(jobQueue.workspaceId, user.workspaceId)))
      .limit(1);
    expect(job).toBeDefined();

    await (queueManager as unknown as { processJob: (queuedJob: unknown) => Promise<void> }).processJob(job!);

    const orgRows = await db
      .select({ id: organizations.id, name: organizations.name, data: organizations.data })
      .from(organizations)
      .where(eq(organizations.workspaceId, user.workspaceId));
    expect(orgRows).toHaveLength(2);
    const createdOrg = orgRows.find((org) => org.name === 'New Retail Org');
    expect(createdOrg).toBeDefined();

    expect(addJobSpy).toHaveBeenCalledTimes(1);
    expect(addJobSpy).toHaveBeenCalledWith(
      'initiative_list',
      expect.objectContaining({
        folderId,
        orgIds: expect.arrayContaining([existingOrganizationId, createdOrg!.id]),
        workflow: expect.objectContaining({
          taskKey: 'generation_usecase_list',
          workflowRunId,
          workflowDefinitionId,
        }),
      }),
      expect.objectContaining({ workspaceId: user.workspaceId, maxRetries: 1 }),
    );

    const [runState] = await db
      .select()
      .from(workflowRunState)
      .where(eq(workflowRunState.runId, workflowRunId))
      .limit(1);
    const state = (runState?.state ?? {}) as Record<string, any>;
    expect(runState?.currentTaskKey).toBe('generation_usecase_list');
    expect(runState?.status).toBe('in_progress');
    expect(state.orgContext.effectiveOrgIds).toEqual(
      expect.arrayContaining([existingOrganizationId, createdOrg!.id]),
    );
    expect(state.orgContext.createdOrgIds).toEqual([createdOrg!.id]);

    const [taskResult] = await db
      .select()
      .from(workflowTaskResults)
      .where(
        and(
          eq(workflowTaskResults.runId, workflowRunId),
          eq(workflowTaskResults.taskKey, 'generation_create_organizations'),
          eq(workflowTaskResults.taskInstanceKey, 'main'),
        ),
      )
      .limit(1);
    expect(taskResult?.status).toBe('completed');
    expect((taskResult?.output as Record<string, unknown>).effectiveOrgIds).toEqual(
      expect.arrayContaining([existingOrganizationId, createdOrg!.id]),
    );

    const [jobAfter] = await db
      .select({ status: jobQueue.status })
      .from(jobQueue)
      .where(eq(jobQueue.id, jobId))
      .limit(1);
    expect(jobAfter?.status).toBe('completed');
  });
});
