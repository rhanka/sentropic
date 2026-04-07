import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { app } from '../../src/app';
import { db } from '../../src/db/client';
import { defaultMatrixConfig } from '../../src/config/default-matrix';
import { agentDefinitions, folders, jobQueue, organizations, initiatives } from '../../src/db/schema';
import { queueManager } from '../../src/services/queue-manager';
import {
  authenticatedRequest,
  cleanupAuthData,
  createAuthenticatedUser,
} from '../utils/auth-helper';
import { createTestId } from '../utils/test-helpers';

describe('Use Cases Generate - Matrix Mode', () => {
  let user: Awaited<ReturnType<typeof createAuthenticatedUser>>;
  let processJobsSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    user = await createAuthenticatedUser('editor');
    processJobsSpy = vi.spyOn(queueManager, 'processJobs').mockResolvedValue();
  });

  afterEach(async () => {
    processJobsSpy.mockRestore();
    await db.delete(jobQueue).where(eq(jobQueue.workspaceId, user.workspaceId));
    await db.delete(initiatives).where(eq(initiatives.workspaceId, user.workspaceId));
    await db.delete(folders).where(eq(folders.workspaceId, user.workspaceId));
    await db.delete(organizations).where(eq(organizations.workspaceId, user.workspaceId));
    await cleanupAuthData();
  });

  async function createOrganization() {
    const response = await authenticatedRequest(app, 'POST', '/api/v1/organizations', user.sessionToken!, {
      name: `Org ${createTestId()}`,
      industry: 'Tech',
    });
    expect(response.status).toBe(201);
    const org = await response.json();
    return org.id as string;
  }

  async function getWorkflowRoleForJob(jobId: string) {
    const [job] = await db
      .select()
      .from(jobQueue)
      .where(and(eq(jobQueue.id, jobId), eq(jobQueue.workspaceId, user.workspaceId)))
      .limit(1);
    expect(job).toBeDefined();

    const payload = JSON.parse(String(job!.data)) as {
      workflow?: { agentDefinitionId?: string | null; agentMap?: Record<string, string>; taskKey?: string };
    };
    const workflow = payload.workflow;
    expect(typeof workflow?.agentDefinitionId).toBe('string');
    const [agent] = await db
      .select({ config: agentDefinitions.config })
      .from(agentDefinitions)
      .where(and(eq(agentDefinitions.id, workflow!.agentDefinitionId!), eq(agentDefinitions.workspaceId, user.workspaceId)))
      .limit(1);
    expect(agent).toBeDefined();
    return {
      role: (agent!.config as Record<string, unknown> | null)?.role as string | undefined,
      taskKey: workflow?.taskKey,
      agentMap: workflow?.agentMap ?? {},
      agentDefinitionId: workflow?.agentDefinitionId ?? null,
    };
  }

  async function getJob(jobId: string) {
    const [job] = await db
      .select()
      .from(jobQueue)
      .where(and(eq(jobQueue.id, jobId), eq(jobQueue.workspaceId, user.workspaceId)))
      .limit(1);
    expect(job).toBeDefined();
    return job!;
  }

  it('defaults to matrix_mode=default when no organization is provided', async () => {
    const response = await authenticatedRequest(
      app,
      'POST',
      '/api/v1/initiatives/generate',
      user.sessionToken!,
      {
        input: `Generate ${createTestId()}`,
        initiative_count: 1,
      }
    );

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.matrix_mode).toBe('default');
    expect(data.matrixJobId).toBeUndefined();
    expect(data.jobId).toBeDefined();
    expect(data.folder_id).toBeDefined();

    const [folder] = await db
      .select()
      .from(folders)
      .where(and(eq(folders.id, data.folder_id), eq(folders.workspaceId, user.workspaceId)))
      .limit(1);
    expect(folder).toBeDefined();
    expect(folder?.matrixConfig).toBeTruthy();
    expect(JSON.parse(folder!.matrixConfig!)).toEqual(defaultMatrixConfig);

    const workflowRole = await getWorkflowRoleForJob(data.jobId);
    expect(workflowRole.role).toBe('usecase_list_generation');
  });

  it('defaults to matrix_mode=organization when org template exists', async () => {
    const organizationId = await createOrganization();
    const organizationTemplate = {
      ...defaultMatrixConfig,
      valueAxes: defaultMatrixConfig.valueAxes.map((axis) => ({
        ...axis,
        description: `${axis.description} (org template)`,
      })),
    };

    await db
      .update(organizations)
      .set({
        data: {
          industry: 'Tech',
          references: [],
          matrixTemplate: organizationTemplate,
        },
      })
      .where(and(eq(organizations.id, organizationId), eq(organizations.workspaceId, user.workspaceId)));

    const response = await authenticatedRequest(
      app,
      'POST',
      '/api/v1/initiatives/generate',
      user.sessionToken!,
      {
        input: `Generate ${createTestId()}`,
        organization_id: organizationId,
        initiative_count: 1,
      }
    );

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.matrix_mode).toBe('organization');
    expect(data.matrixJobId).toBeUndefined();

    const [folder] = await db
      .select()
      .from(folders)
      .where(and(eq(folders.id, data.folder_id), eq(folders.workspaceId, user.workspaceId)))
      .limit(1);
    expect(folder).toBeDefined();
    expect(JSON.parse(folder!.matrixConfig!)).toEqual(organizationTemplate);
  });

  it('defaults to matrix_mode=generate when org template is missing and enqueues matrix job', async () => {
    const organizationId = await createOrganization();

    const response = await authenticatedRequest(
      app,
      'POST',
      '/api/v1/initiatives/generate',
      user.sessionToken!,
      {
        input: `Generate ${createTestId()}`,
        organization_id: organizationId,
        initiative_count: 1,
      }
    );

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.matrix_mode).toBe('generate');
    expect(data.matrixJobId).toBeDefined();
    expect(data.jobId).toBeDefined();

    const jobs = await db
      .select()
      .from(jobQueue)
      .where(eq(jobQueue.workspaceId, user.workspaceId));

    const initiativeListJob = jobs.find((job) => job.id === data.jobId);
    const matrixJob = jobs.find((job) => job.id === data.matrixJobId);
    expect(initiativeListJob?.type).toBe('initiative_list');
    expect(matrixJob?.type).toBe('matrix_generate');
    const initiativeListPayload = initiativeListJob ? (JSON.parse(String(initiativeListJob.data)) as Record<string, unknown>) : null;
    const matrixPayload = matrixJob ? (JSON.parse(String(matrixJob.data)) as Record<string, unknown>) : null;
    const initiativeListWorkflow = initiativeListPayload?.workflow as Record<string, unknown> | undefined;
    const matrixWorkflow = matrixPayload?.workflow as Record<string, unknown> | undefined;
    expect(typeof initiativeListWorkflow?.workflowRunId).toBe('string');
    expect(typeof initiativeListWorkflow?.workflowDefinitionId).toBe('string');
    // TODO: Lot 10 will migrate task key to generation_initiative_list
    expect(initiativeListWorkflow?.taskKey).toBe('generation_usecase_list');
    expect(typeof initiativeListWorkflow?.agentDefinitionId).toBe('string');
    expect(typeof matrixWorkflow?.workflowRunId).toBe('string');
    expect(typeof matrixWorkflow?.workflowDefinitionId).toBe('string');
    expect(matrixWorkflow?.taskKey).toBe('generation_matrix_prepare');
    expect(typeof matrixWorkflow?.agentDefinitionId).toBe('string');
    // BR-04: workflow payload uses agentMap (taskKey → agentDefinitionId) instead of taskAssignments
    const agentMap = initiativeListWorkflow?.agentMap as Record<string, unknown> | undefined;
    expect(agentMap).toBeDefined();
    expect(typeof agentMap?.generation_context_prepare).toBe('string');
    expect(typeof agentMap?.generation_matrix_prepare).toBe('string');
    expect(typeof agentMap?.generation_usecase_list).toBe('string');
    expect(typeof agentMap?.generation_todo_sync).toBe('string');
    expect(typeof agentMap?.generation_usecase_detail).toBe('string');
    expect(typeof agentMap?.generation_executive_summary).toBe('string');
  });

  it('routes initiative generation through initiative_list_with_orgs when org_ids are provided', async () => {
    const organizationId = await createOrganization();

    const response = await authenticatedRequest(
      app,
      'POST',
      '/api/v1/initiatives/generate',
      user.sessionToken!,
      {
        input: `Generate ${createTestId()}`,
        initiative_count: 1,
        org_ids: [organizationId],
      }
    );

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.jobId).toBeDefined();

    const job = await getJob(data.jobId);
    expect(job.type).toBe('initiative_list');
    const payload = JSON.parse(String(job.data)) as {
      workflow?: { workflowRunId?: string; workflowDefinitionId?: string };
    };
    expect(typeof payload.workflow?.workflowRunId).toBe('string');
    expect(typeof payload.workflow?.workflowDefinitionId).toBe('string');

    const workflowRole = await getWorkflowRoleForJob(data.jobId);
    expect(workflowRole.taskKey).toBe('generation_usecase_list');
    expect(workflowRole.role).toBe('initiative_list_with_orgs');
    expect(workflowRole.agentMap.generation_usecase_list).toBe(workflowRole.agentDefinitionId);

    const jobs = await db
      .select()
      .from(jobQueue)
      .where(eq(jobQueue.workspaceId, user.workspaceId));
    expect(jobs.some((queuedJob) => queuedJob.type === 'organization_batch_create')).toBe(false);
  });

  it('routes initiative generation through initiative_list_with_orgs when create_new_orgs is true', async () => {
    const response = await authenticatedRequest(
      app,
      'POST',
      '/api/v1/initiatives/generate',
      user.sessionToken!,
      {
        input: `Generate ${createTestId()}`,
        initiative_count: 1,
        create_new_orgs: true,
      }
    );

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.jobId).toBeDefined();

    const jobs = await db
      .select()
      .from(jobQueue)
      .where(eq(jobQueue.workspaceId, user.workspaceId));
    const initiativeListJob = jobs.find((job) => job.id === data.jobId);
    expect(initiativeListJob?.type).toBe('initiative_list');
    expect(jobs.some((job) => job.type === 'organization_batch_create')).toBe(false);

    const payload = JSON.parse(String(initiativeListJob!.data)) as {
      workflow?: {
        workflowRunId?: string;
        workflowDefinitionId?: string;
        taskKey?: string;
        agentMap?: Record<string, string>;
      };
    };
    expect(payload.workflow?.taskKey).toBe('generation_usecase_list');
    expect(typeof payload.workflow?.workflowRunId).toBe('string');
    expect(typeof payload.workflow?.workflowDefinitionId).toBe('string');
    expect(typeof payload.workflow?.agentMap?.generation_usecase_list).toBe('string');
  });

  it('rejects explicit matrix_mode=organization when organization has no template', async () => {
    const organizationId = await createOrganization();

    const response = await authenticatedRequest(
      app,
      'POST',
      '/api/v1/initiatives/generate',
      user.sessionToken!,
      {
        input: `Generate ${createTestId()}`,
        organization_id: organizationId,
        matrix_mode: 'organization',
      }
    );

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.message).toBe('Organization matrix template not found');
  });

  it('accepts explicit matrix_mode=default even when an org template exists', async () => {
    const organizationId = await createOrganization();
    const organizationTemplate = {
      ...defaultMatrixConfig,
      valueAxes: defaultMatrixConfig.valueAxes.map((axis) => ({
        ...axis,
        description: `${axis.description} (org template)`,
      })),
    };

    await db
      .update(organizations)
      .set({
        data: {
          industry: 'Tech',
          references: [],
          matrixTemplate: organizationTemplate,
        },
      })
      .where(and(eq(organizations.id, organizationId), eq(organizations.workspaceId, user.workspaceId)));

    const response = await authenticatedRequest(
      app,
      'POST',
      '/api/v1/initiatives/generate',
      user.sessionToken!,
      {
        input: `Generate ${createTestId()}`,
        organization_id: organizationId,
        matrix_mode: 'default',
        initiative_count: 1,
      }
    );

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.matrix_mode).toBe('default');
    expect(data.matrixJobId).toBeUndefined();

    const [folder] = await db
      .select()
      .from(folders)
      .where(and(eq(folders.id, data.folder_id), eq(folders.workspaceId, user.workspaceId)))
      .limit(1);
    expect(folder).toBeDefined();
    expect(JSON.parse(folder!.matrixConfig!)).toEqual(defaultMatrixConfig);
  });

  it('accepts explicit matrix_mode=generate when org template exists and enqueues matrix job', async () => {
    const organizationId = await createOrganization();
    await db
      .update(organizations)
      .set({
        data: {
          industry: 'Tech',
          references: [],
          matrixTemplate: defaultMatrixConfig,
        },
      })
      .where(and(eq(organizations.id, organizationId), eq(organizations.workspaceId, user.workspaceId)));

    const response = await authenticatedRequest(
      app,
      'POST',
      '/api/v1/initiatives/generate',
      user.sessionToken!,
      {
        input: `Generate ${createTestId()}`,
        organization_id: organizationId,
        matrix_mode: 'generate',
        initiative_count: 1,
      }
    );

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.matrix_mode).toBe('generate');
    expect(data.matrixJobId).toBeDefined();

    const jobs = await db
      .select()
      .from(jobQueue)
      .where(eq(jobQueue.workspaceId, user.workspaceId));
    const initiativeListJob = jobs.find((job) => job.id === data.jobId);
    const matrixJob = jobs.find((job) => job.id === data.matrixJobId);
    expect(initiativeListJob?.type).toBe('initiative_list');
    expect(matrixJob?.type).toBe('matrix_generate');
    const initiativeListPayload = initiativeListJob ? (JSON.parse(String(initiativeListJob.data)) as Record<string, unknown>) : null;
    const matrixPayload = matrixJob ? (JSON.parse(String(matrixJob.data)) as Record<string, unknown>) : null;
    const initiativeListWorkflow = initiativeListPayload?.workflow as Record<string, unknown> | undefined;
    const matrixWorkflow = matrixPayload?.workflow as Record<string, unknown> | undefined;
    expect(typeof initiativeListWorkflow?.workflowRunId).toBe('string');
    expect(typeof initiativeListWorkflow?.workflowDefinitionId).toBe('string');
    // TODO: Lot 10 will migrate task key to generation_initiative_list
    expect(initiativeListWorkflow?.taskKey).toBe('generation_usecase_list');
    expect(typeof initiativeListWorkflow?.agentDefinitionId).toBe('string');
    expect(typeof matrixWorkflow?.workflowRunId).toBe('string');
    expect(typeof matrixWorkflow?.workflowDefinitionId).toBe('string');
    expect(matrixWorkflow?.taskKey).toBe('generation_matrix_prepare');
    expect(typeof matrixWorkflow?.agentDefinitionId).toBe('string');
    // BR-04: workflow payload uses agentMap (taskKey → agentDefinitionId) instead of taskAssignments
    const agentMap = initiativeListWorkflow?.agentMap as Record<string, unknown> | undefined;
    expect(agentMap).toBeDefined();
    expect(typeof agentMap?.generation_context_prepare).toBe('string');
    expect(typeof agentMap?.generation_matrix_prepare).toBe('string');
    expect(typeof agentMap?.generation_usecase_list).toBe('string');
    expect(typeof agentMap?.generation_todo_sync).toBe('string');
    expect(typeof agentMap?.generation_usecase_detail).toBe('string');
    expect(typeof agentMap?.generation_executive_summary).toBe('string');
  });

  it('accepts explicit matrix_mode=generate without organization and enqueues an ad hoc matrix job', async () => {
    const response = await authenticatedRequest(
      app,
      'POST',
      '/api/v1/initiatives/generate',
      user.sessionToken!,
      {
        input: `Generate ${createTestId()}`,
        matrix_mode: 'generate',
      }
    );

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.matrix_mode).toBe('generate');
    expect(data.matrixJobId).toBeDefined();
    expect(data.jobId).toBeDefined();

    const jobs = await db
      .select()
      .from(jobQueue)
      .where(eq(jobQueue.workspaceId, user.workspaceId));
    const initiativeListJob = jobs.find((job) => job.id === data.jobId);
    const matrixJob = jobs.find((job) => job.id === data.matrixJobId);
    expect(initiativeListJob?.type).toBe('initiative_list');
    expect(matrixJob?.type).toBe('matrix_generate');

    const [folder] = await db
      .select()
      .from(folders)
      .where(and(eq(folders.id, data.folder_id), eq(folders.workspaceId, user.workspaceId)))
      .limit(1);
    expect(folder).toBeDefined();
    expect(folder?.organizationId).toBeNull();
    expect(folder?.matrixConfig).toBeNull();
  });

  it('blocks usecase detail when matrix_generate failed for the folder (strict policy)', async () => {
    const organizationId = await createOrganization();
    const folderId = createTestId();
    const initiativeId = createTestId();

    await db.insert(folders).values({
      id: folderId,
      workspaceId: user.workspaceId!,
      name: `Matrix strict ${createTestId()}`,
      description: 'Folder waiting for generated matrix',
      organizationId,
      matrixConfig: null,
      status: 'generating',
      createdAt: new Date(),
    });

    await db.insert(initiatives).values({
      id: initiativeId,
      workspaceId: user.workspaceId!,
      folderId,
      organizationId,
      status: 'generating',
      data: {
        name: 'Use case waiting matrix',
        description: 'Should fail before detail generation',
      },
      createdAt: new Date(),
    });

    await db.insert(jobQueue).values({
      id: createTestId(),
      type: 'matrix_generate',
      status: 'failed',
      workspaceId: user.workspaceId!,
      data: JSON.stringify({ folderId, organizationId }),
      error: 'Matrix generation failed for strict-policy test',
      createdAt: new Date(),
    });

    await expect(
      (queueManager as unknown as {
        processInitiativeDetail: (data: Record<string, unknown>) => Promise<void>;
      }).processInitiativeDetail({
        initiativeId,
        initiativeName: 'Use case waiting matrix',
        folderId,
        matrixMode: 'generate',
        model: 'gpt-4.1-nano',
      })
    ).rejects.toThrow('Matrix generation failed for strict-policy test');
  });
});
