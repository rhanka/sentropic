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

  it('prepares organization targets from org-aware list outputs and enqueues visible organization_enrich jobs', async () => {
    const folderId = createId();
    const workflowDefinitionId = createId();
    const workflowRunId = createId();
    const jobId = createId();
    const existingOrganizationId = createId();
    const enqueuedExistingEnrichJobId = createId();
    const enqueuedCreatedEnrichJobId = createId();
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
        taskKey: 'generation_organization_enrich',
        title: 'Organization create or enrich',
        description: 'Create or enrich one visible organization target',
        orderIndex: 2,
        agentDefinitionId: null,
        metadata: {
          executor: 'job',
          jobType: 'organization_enrich',
          inputBindings: {
            organizationId: '$item.organizationId',
            organizationName: '$item.organizationName',
            model: '$state.inputs.model',
            initiatedByUserId: '$run.startedByUserId',
            locale: '$state.inputs.locale',
            skipIfCompleted: '$item.skipIfCompleted',
            wasCreated: '$item.wasCreated',
          },
        },
        createdAt: now,
        updatedAt: now,
      },
      {
        id: createId(),
        workspaceId: user.workspaceId,
        workflowDefinitionId,
        taskKey: 'generation_organization_join',
        title: 'Organization targets join',
        description: 'Join organization fanout before list generation',
        orderIndex: 3,
        agentDefinitionId: null,
        metadata: {
          executor: 'job',
          jobType: 'organization_targets_join',
          inputBindings: {
            sourceTaskKey: 'generation_organization_enrich',
          },
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
        orderIndex: 4,
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
      toTaskKey: 'generation_organization_enrich',
      transitionType: 'fanout',
      condition: {},
      metadata: {
        fanout: {
          sourcePath: 'orgContext.organizationTargets',
          itemKey: 'organizationTarget',
          instanceKeyPath: 'organizationId',
        },
      },
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(workflowTaskTransitions).values({
      id: createId(),
      workspaceId: user.workspaceId,
      workflowDefinitionId,
      fromTaskKey: 'generation_organization_enrich',
      toTaskKey: 'generation_organization_join',
      transitionType: 'join',
      condition: {},
      metadata: {
        join: {
          taskKey: 'generation_organization_enrich',
          mode: 'all',
          expectedSourcePath: 'orgContext.organizationTargets',
        },
      },
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(workflowTaskTransitions).values({
      id: createId(),
      workspaceId: user.workspaceId,
      workflowDefinitionId,
      fromTaskKey: 'generation_organization_join',
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
          organizationTargets: [],
        },
        generation: {
          initiativeIds: ['initiative-existing', 'initiative-new'],
          initiatives: [
            {
              id: 'initiative-existing',
              name: 'Dynamic pricing for Existing Org',
              organizationIds: [existingOrganizationId],
            },
            {
              id: 'initiative-new',
              name: 'Retail forecasting platform',
              organizationName: 'New Retail Org',
            },
          ],
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
            generation_organization_enrich: 'agent_enrich',
            generation_organization_join: 'agent_join',
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

    const addJobSpy = vi
      .spyOn(queueManager, 'addJob')
      .mockResolvedValueOnce(enqueuedExistingEnrichJobId)
      .mockResolvedValueOnce(enqueuedCreatedEnrichJobId);

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

    expect(addJobSpy).toHaveBeenCalledTimes(2);
    expect(addJobSpy).toHaveBeenNthCalledWith(
      1,
      'organization_enrich',
      expect.objectContaining({
        organizationId: existingOrganizationId,
        organizationName: 'Existing Org',
        skipIfCompleted: true,
        wasCreated: false,
        workflow: expect.objectContaining({
          taskKey: 'generation_organization_enrich',
          workflowRunId,
          workflowDefinitionId,
        }),
      }),
      expect.objectContaining({ workspaceId: user.workspaceId, maxRetries: 1 }),
    );
    expect(addJobSpy).toHaveBeenNthCalledWith(
      2,
      'organization_enrich',
      expect.objectContaining({
        organizationId: createdOrg!.id,
        organizationName: 'New Retail Org',
        skipIfCompleted: false,
        wasCreated: true,
        workflow: expect.objectContaining({
          taskKey: 'generation_organization_enrich',
          workflowRunId,
          workflowDefinitionId,
        }),
      }),
      expect.objectContaining({ workspaceId: user.workspaceId, maxRetries: 1 }),
    );
    expect(addJobSpy.mock.calls.some(([jobType]) => jobType === 'initiative_list')).toBe(false);
    expect(mockExecuteWithToolsStream).not.toHaveBeenCalled();

    const [runState] = await db
      .select()
      .from(workflowRunState)
      .where(eq(workflowRunState.runId, workflowRunId))
      .limit(1);
    const state = (runState?.state ?? {}) as Record<string, any>;
    expect(runState?.status).toBe('in_progress');
    expect(runState?.currentTaskKey).toBe('generation_organization_enrich');
    expect(state.orgContext.organizationTargets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          organizationId: existingOrganizationId,
          organizationName: 'Existing Org',
          skipIfCompleted: true,
          wasCreated: false,
        }),
        expect.objectContaining({
          organizationId: createdOrg!.id,
          organizationName: 'New Retail Org',
          skipIfCompleted: false,
          wasCreated: true,
        }),
      ]),
    );
    expect(state.orgContext.createdOrgIds).toEqual([createdOrg!.id]);
    expect(state.generation.initiatives).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'initiative-existing',
          organizationIds: [existingOrganizationId],
        }),
        expect.objectContaining({
          id: 'initiative-new',
          organizationIds: [createdOrg!.id],
          organizationName: 'New Retail Org',
        }),
      ]),
    );

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
    expect((taskResult?.output as Record<string, unknown>).organizationTargets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ organizationId: existingOrganizationId }),
        expect.objectContaining({ organizationId: createdOrg!.id }),
      ]),
    );

    const enrichTaskResults = await db
      .select({
        taskInstanceKey: workflowTaskResults.taskInstanceKey,
        status: workflowTaskResults.status,
      })
      .from(workflowTaskResults)
      .where(
        and(
          eq(workflowTaskResults.runId, workflowRunId),
          eq(workflowTaskResults.taskKey, 'generation_organization_enrich'),
        ),
      );
    expect(enrichTaskResults).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ taskInstanceKey: existingOrganizationId, status: 'pending' }),
        expect.objectContaining({ taskInstanceKey: createdOrg!.id, status: 'pending' }),
      ]),
    );

    const [jobAfter] = await db
      .select({ status: jobQueue.status })
      .from(jobQueue)
      .where(eq(jobQueue.id, jobId))
      .limit(1);
    expect(jobAfter?.status).toBe('completed');
  });

  it('joins resolved organization targets and enqueues initiative_list with effective org ids', async () => {
    const folderId = createId();
    const workflowDefinitionId = createId();
    const workflowRunId = createId();
    const joinJobId = createId();
    const existingOrganizationId = createId();
    const createdOrganizationId = createId();
    const enqueuedListJobId = createId();
    const now = new Date();

    await db.insert(organizations).values([
      {
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
      },
      {
        id: createdOrganizationId,
        workspaceId: user.workspaceId,
        name: 'New Retail Org',
        status: 'completed',
        data: {
          industry: 'Retail',
          size: '',
          products: '',
          processes: '',
          kpis: '',
          challenges: '',
          objectives: 'Retail organization to include in the initiative generation scope.',
          technologies: '',
          references: [],
          location: 'Paris, France',
        },
        createdAt: now,
        updatedAt: now,
      },
    ]);

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
        taskKey: 'generation_organization_join',
        title: 'Organization targets join',
        description: 'Join organization fanout before list generation',
        orderIndex: 1,
        agentDefinitionId: null,
        metadata: {
          executor: 'job',
          jobType: 'organization_targets_join',
          inputBindings: {
            sourceTaskKey: 'generation_organization_enrich',
          },
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
      fromTaskKey: 'generation_organization_join',
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
          createdOrgIds: [createdOrganizationId],
          createdOrganizations: [],
          organizationTargets: [
            {
              organizationId: existingOrganizationId,
              organizationName: 'Existing Org',
              skipIfCompleted: true,
              wasCreated: false,
            },
            {
              organizationId: createdOrganizationId,
              organizationName: 'New Retail Org',
              skipIfCompleted: false,
              wasCreated: true,
            },
          ],
        },
        generation: {
          initiativeIds: [],
        },
      },
      version: 1,
      currentTaskKey: 'generation_organization_join',
      currentTaskInstanceKey: 'main',
      checkpointedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(workflowTaskResults).values([
      {
        id: createId(),
        workspaceId: user.workspaceId,
        runId: workflowRunId,
        taskKey: 'generation_organization_enrich',
        taskInstanceKey: existingOrganizationId,
        status: 'completed',
        inputPayload: {},
        output: {
          organizationId: existingOrganizationId,
          organizationName: 'Existing Org',
          wasCreated: false,
          skipped: true,
        },
        statePatch: {},
        attempts: 1,
        lastError: null,
        startedAt: now,
        completedAt: now,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: createId(),
        workspaceId: user.workspaceId,
        runId: workflowRunId,
        taskKey: 'generation_organization_enrich',
        taskInstanceKey: createdOrganizationId,
        status: 'completed',
        inputPayload: {},
        output: {
          organizationId: createdOrganizationId,
          organizationName: 'New Retail Org',
          wasCreated: true,
          skipped: false,
        },
        statePatch: {},
        attempts: 1,
        lastError: null,
        startedAt: now,
        completedAt: now,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    await db.insert(jobQueue).values({
      id: joinJobId,
      type: 'organization_targets_join',
      status: 'processing',
      workspaceId: user.workspaceId,
      data: JSON.stringify({
        sourceTaskKey: 'generation_organization_enrich',
        workflow: {
          workflowRunId,
          workflowDefinitionId,
          taskKey: 'generation_organization_join',
          agentDefinitionId: null,
          agentMap: {
            generation_organization_join: 'agent_join',
            generation_usecase_list: 'agent_list_with_orgs',
          },
        },
      }),
      createdAt: now,
      startedAt: now,
    });

    const addJobSpy = vi.spyOn(queueManager, 'addJob').mockResolvedValue(enqueuedListJobId);

    const [job] = await db
      .select()
      .from(jobQueue)
      .where(and(eq(jobQueue.id, joinJobId), eq(jobQueue.workspaceId, user.workspaceId)))
      .limit(1);
    expect(job).toBeDefined();

    await (queueManager as unknown as { processJob: (queuedJob: unknown) => Promise<void> }).processJob(job!);

    expect(addJobSpy).toHaveBeenCalledTimes(1);
    expect(addJobSpy).toHaveBeenCalledWith(
      'initiative_list',
      expect.objectContaining({
        folderId,
        orgIds: expect.arrayContaining([existingOrganizationId, createdOrganizationId]),
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
    expect(runState?.status).toBe('in_progress');
    expect(state.orgContext.effectiveOrgIds).toEqual(
      expect.arrayContaining([existingOrganizationId, createdOrganizationId]),
    );
    expect(state.orgContext.createdOrgIds).toEqual([createdOrganizationId]);
    expect(state.orgContext.createdOrganizations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: createdOrganizationId,
          name: 'New Retail Org',
        }),
      ]),
    );

    const [taskResult] = await db
      .select()
      .from(workflowTaskResults)
      .where(
        and(
          eq(workflowTaskResults.runId, workflowRunId),
          eq(workflowTaskResults.taskKey, 'generation_organization_join'),
          eq(workflowTaskResults.taskInstanceKey, 'main'),
        ),
      )
      .limit(1);
    expect(taskResult?.status).toBe('completed');
    expect((taskResult?.output as Record<string, unknown>).effectiveOrgIds).toEqual(
      expect.arrayContaining([existingOrganizationId, createdOrganizationId]),
    );
  });

  it('fails fast when organization target preparation runs before the org-aware list step', async () => {
    const folderId = createId();
    const workflowDefinitionId = createId();
    const workflowRunId = createId();
    const jobId = createId();
    const now = new Date();

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
      key: 'opportunity_identification',
      name: 'Workflow',
      description: 'Test workflow',
      config: {},
      sourceLevel: 'code',
      isDetached: false,
      createdByUserId: user.userId,
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(workflowDefinitionTasks).values({
      id: createId(),
      workspaceId: user.workspaceId,
      workflowDefinitionId,
      taskKey: 'create_organizations',
      title: 'Create organizations',
      description: 'Create organizations before opportunity identification',
      orderIndex: 1,
      agentDefinitionId: null,
      metadata: {
        executor: 'job',
        jobType: 'organization_batch_create',
      },
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
          input: 'Opportunités pour Airudi à Montréal',
          matrixMode: 'generate',
          matrixSource: 'prompt',
          initiativeCount: 10,
          locale: 'fr',
          organizationId: null,
          model: 'gpt-5.5',
          autoCreateOrganizations: true,
        },
        orgContext: {
          selectedOrgIds: [],
          createdOrgIds: [],
          createdOrganizations: [],
        },
        generation: {
          initiativeIds: [],
          initiatives: [],
        },
      },
      version: 1,
      currentTaskKey: 'create_organizations',
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
        input: 'Opportunités pour Airudi à Montréal',
        model: 'gpt-5.5',
        locale: 'fr',
        initiatedByUserId: user.userId,
        workflow: {
          workflowRunId,
          workflowDefinitionId,
          taskKey: 'create_organizations',
          agentDefinitionId: null,
          agentMap: {
            create_organizations: 'agent_batch',
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

    const [job] = await db
      .select()
      .from(jobQueue)
      .where(and(eq(jobQueue.id, jobId), eq(jobQueue.workspaceId, user.workspaceId)))
      .limit(1);
    expect(job).toBeDefined();

    await (queueManager as unknown as { processJob: (queuedJob: unknown) => Promise<void> }).processJob(job!);

    const [jobAfter] = await db
      .select({ status: jobQueue.status, error: jobQueue.error, data: jobQueue.data, startedAt: jobQueue.startedAt })
      .from(jobQueue)
      .where(eq(jobQueue.id, jobId))
      .limit(1);
    const jobAfterData =
      typeof jobAfter?.data === 'string'
        ? JSON.parse(jobAfter.data)
        : (jobAfter?.data as Record<string, unknown> | undefined);
    expect(jobAfter?.status).toBe('failed');
    expect(jobAfter?.error).toContain('Organization target preparation requires org-aware list outputs');
    expect((jobAfterData as Record<string, any>)._retry).toEqual({ attempt: 0, maxRetries: 1 });

    const [taskResult] = await db
      .select()
      .from(workflowTaskResults)
      .where(
        and(
          eq(workflowTaskResults.runId, workflowRunId),
          eq(workflowTaskResults.taskKey, 'create_organizations'),
          eq(workflowTaskResults.taskInstanceKey, 'main'),
        ),
      )
      .limit(1);
    expect(taskResult?.status).toBe('failed');
    expect(taskResult?.attempts).toBe(1);
    expect(taskResult?.completedAt).not.toBeNull();
    expect((taskResult?.lastError as Record<string, unknown>)?.message).toBe(
      'Organization target preparation requires org-aware list outputs',
    );

    const [runState] = await db
      .select()
      .from(workflowRunState)
      .where(eq(workflowRunState.runId, workflowRunId))
      .limit(1);
    expect(runState?.status).toBe('failed');
    expect(runState?.currentTaskKey).toBe('create_organizations');
  });

  it('completes organization target preparation with no-op targets when the org-aware list stays generic', async () => {
    const folderId = createId();
    const workflowDefinitionId = createId();
    const workflowRunId = createId();
    const jobId = createId();
    const now = new Date();

    await db.insert(folders).values({
      id: folderId,
      workspaceId: user.workspaceId,
      name: 'Folder',
      description: 'Generic demand',
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

    await db.insert(workflowDefinitionTasks).values({
      id: createId(),
      workspaceId: user.workspaceId,
      workflowDefinitionId,
      taskKey: 'generation_create_organizations',
      title: 'Create organizations',
      description: 'Prepare organization targets after the org-aware list',
      orderIndex: 1,
      agentDefinitionId: null,
      metadata: {
        executor: 'job',
        jobType: 'organization_batch_create',
      },
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
          input: 'Digital twin manufacturier',
          matrixMode: 'default',
          initiativeCount: 2,
          locale: 'fr',
          organizationId: null,
          model: 'gpt-5.5',
          autoCreateOrganizations: true,
        },
        orgContext: {
          selectedOrgIds: [],
          createdOrgIds: [],
          createdOrganizations: [],
          organizationTargets: [],
        },
        generation: {
          initiativeIds: ['initiative-a', 'initiative-b'],
          initiatives: [
            { id: 'initiative-a', name: 'Digital twin usine', description: 'Description A' },
            { id: 'initiative-b', name: 'Maintenance predictive', description: 'Description B' },
          ],
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
        input: 'Digital twin manufacturier',
        model: 'gpt-5.5',
        locale: 'fr',
        initiatedByUserId: user.userId,
        workflow: {
          workflowRunId,
          workflowDefinitionId,
          taskKey: 'generation_create_organizations',
          agentDefinitionId: null,
          agentMap: {},
        },
        _retry: {
          attempt: 0,
          maxRetries: 1,
        },
      }),
      createdAt: now,
      startedAt: now,
    });

    const [job] = await db
      .select()
      .from(jobQueue)
      .where(and(eq(jobQueue.id, jobId), eq(jobQueue.workspaceId, user.workspaceId)))
      .limit(1);
    expect(job).toBeDefined();

    await (queueManager as unknown as { processJob: (queuedJob: unknown) => Promise<void> }).processJob(job!);

    const [jobAfter] = await db
      .select({ status: jobQueue.status })
      .from(jobQueue)
      .where(eq(jobQueue.id, jobId))
      .limit(1);
    expect(jobAfter?.status).toBe('completed');

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
    expect((taskResult?.output as Record<string, unknown>).resolvedTargetCount).toBe(0);
    expect((taskResult?.output as Record<string, unknown>).organizationTargets).toEqual([]);

    const [runState] = await db
      .select()
      .from(workflowRunState)
      .where(eq(workflowRunState.runId, workflowRunId))
      .limit(1);
    const state = (runState?.state ?? {}) as Record<string, any>;
    expect(state.orgContext.organizationTargets).toEqual([]);
    expect(state.generation.initiatives).toEqual([
      expect.objectContaining({ id: 'initiative-a', name: 'Digital twin usine' }),
      expect.objectContaining({ id: 'initiative-b', name: 'Maintenance predictive' }),
    ]);
  });

  it('shared generate_organization (organization_enrich) runs once per org target from both ai_usecase_generation and opportunity_identification', async () => {
    const now = new Date();
    const orgId = createId();

    await db.insert(organizations).values({
      id: orgId,
      workspaceId: user.workspaceId,
      name: 'Shared Org',
      status: 'completed',
      data: {
        industry: 'Tech',
        size: '',
        products: '',
        processes: '',
        kpis: '',
        challenges: '',
        objectives: 'Profile',
        technologies: '',
        references: [],
      },
      createdAt: now,
      updatedAt: now,
    });

    const workflows = [
      { key: 'ai_usecase_generation_v1', taskPrefix: 'generation_' },
      { key: 'opportunity_identification', taskPrefix: '' },
    ] as const;

    for (const wf of workflows) {
      const folderId = createId();
      const workflowDefinitionId = createId();
      const workflowRunId = createId();
      const jobId = createId();

      await db.insert(folders).values({
        id: folderId,
        workspaceId: user.workspaceId,
        name: `Folder for ${wf.key}`,
        description: 'Test',
        organizationId: null,
        matrixConfig: null,
        status: 'generating',
        createdAt: now,
        updatedAt: now,
      });

      await db.insert(workflowDefinitions).values({
        id: workflowDefinitionId,
        workspaceId: user.workspaceId,
        key: wf.key,
        name: `Workflow ${wf.key}`,
        description: 'Test',
        config: {},
        sourceLevel: 'code',
        isDetached: false,
        createdByUserId: user.userId,
        createdAt: now,
        updatedAt: now,
      });

      const batchTaskKey = `${wf.taskPrefix}create_organizations`;
      const enrichTaskKey = `${wf.taskPrefix}organization_enrich`;

      await db.insert(workflowDefinitionTasks).values([
        {
          id: createId(),
          workspaceId: user.workspaceId,
          workflowDefinitionId,
          taskKey: batchTaskKey,
          title: 'Create organizations',
          description: 'Batch create',
          orderIndex: 1,
          agentDefinitionId: null,
          metadata: { executor: 'job', jobType: 'organization_batch_create' },
          createdAt: now,
          updatedAt: now,
        },
        {
          id: createId(),
          workspaceId: user.workspaceId,
          workflowDefinitionId,
          taskKey: enrichTaskKey,
          title: 'Enrich organization',
          description: 'Shared generate_organization agent',
          orderIndex: 2,
          agentDefinitionId: null,
          metadata: {
            executor: 'job',
            jobType: 'organization_enrich',
            inputBindings: {
              organizationId: '$item.organizationId',
              organizationName: '$item.organizationName',
              model: '$state.inputs.model',
              initiatedByUserId: '$run.startedByUserId',
              locale: '$state.inputs.locale',
              skipIfCompleted: '$item.skipIfCompleted',
              wasCreated: '$item.wasCreated',
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
        fromTaskKey: batchTaskKey,
        toTaskKey: enrichTaskKey,
        transitionType: 'fanout',
        condition: {},
        metadata: {
          fanout: {
            sourcePath: 'orgContext.organizationTargets',
            itemKey: 'organizationTarget',
            instanceKeyPath: 'organizationId',
          },
        },
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
            input: 'Test',
            matrixMode: 'default',
            initiativeCount: 2,
            locale: 'fr',
            organizationId: null,
            model: 'gpt-4.1-nano',
            autoCreateOrganizations: true,
          },
          orgContext: {
            selectedOrgIds: [],
            createdOrgIds: [],
            createdOrganizations: [],
            organizationTargets: [],
          },
          generation: {
            initiativeIds: ['item-1'],
            initiatives: [
              { id: 'item-1', name: 'Test item', organizationIds: [orgId] },
            ],
          },
        },
        version: 1,
        currentTaskKey: batchTaskKey,
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
          input: 'Test',
          model: 'gpt-4.1-nano',
          locale: 'fr',
          workflow: {
            workflowRunId,
            workflowDefinitionId,
            taskKey: batchTaskKey,
            agentDefinitionId: null,
            agentMap: { [enrichTaskKey]: 'agent_enrich' },
          },
          _retry: { attempt: 0, maxRetries: 1 },
        }),
        createdAt: now,
        startedAt: now,
      });

      const addJobSpy = vi.spyOn(queueManager, 'addJob').mockResolvedValue(createId());

      const [job] = await db
        .select()
        .from(jobQueue)
        .where(and(eq(jobQueue.id, jobId), eq(jobQueue.workspaceId, user.workspaceId)))
        .limit(1);
      expect(job).toBeDefined();

      await (queueManager as unknown as { processJob: (queuedJob: unknown) => Promise<void> }).processJob(job!);

      // The shared organization_enrich job type is used regardless of which workflow triggered it
      expect(addJobSpy).toHaveBeenCalledTimes(1);
      expect(addJobSpy).toHaveBeenCalledWith(
        'organization_enrich',
        expect.objectContaining({
          organizationId: orgId,
          organizationName: 'Shared Org',
          skipIfCompleted: true,
          wasCreated: false,
          workflow: expect.objectContaining({
            taskKey: enrichTaskKey,
            workflowRunId,
            workflowDefinitionId,
          }),
        }),
        expect.objectContaining({ workspaceId: user.workspaceId }),
      );

      addJobSpy.mockRestore();
    }
  });
});
