import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, asc, eq } from 'drizzle-orm';
import { app } from '../../src/app';
import { db } from '../../src/db/client';
import { defaultMatrixConfig } from '../../src/config/default-matrix';
import {
  executionRuns,
  folders,
  initiatives,
  jobQueue,
  organizations,
  workflowRunState,
  workflowTaskResults,
} from '../../src/db/schema';
import { queueManager } from '../../src/services/queue-manager';
import { authenticatedRequest, cleanupAuthData, createAuthenticatedUser } from '../utils/auth-helper';
import { createTestId } from '../utils/test-helpers';
import * as contextInitiative from '../../src/services/context-initiative';
import * as contextOrganization from '../../src/services/context-organization';
import * as contextMatrix from '../../src/services/context-matrix';
import * as executiveSummaryService from '../../src/services/executive-summary';

describe('Use Cases Generate - Workflow runtime end-to-end', () => {
  let user: Awaited<ReturnType<typeof createAuthenticatedUser>>;
  let processJobsSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    user = await createAuthenticatedUser('editor');
    processJobsSpy = vi.spyOn(queueManager, 'processJobs').mockResolvedValue();
  });

  afterEach(async () => {
    processJobsSpy.mockRestore();
    vi.restoreAllMocks();
    await db.delete(jobQueue).where(eq(jobQueue.workspaceId, user.workspaceId));
    await db.delete(workflowTaskResults).where(eq(workflowTaskResults.workspaceId, user.workspaceId));
    await db.delete(workflowRunState).where(eq(workflowRunState.workspaceId, user.workspaceId));
    await db.delete(executionRuns).where(eq(executionRuns.workspaceId, user.workspaceId));
    await db.delete(initiatives).where(eq(initiatives.workspaceId, user.workspaceId));
    await db.delete(folders).where(eq(folders.workspaceId, user.workspaceId));
    await db.delete(organizations).where(eq(organizations.workspaceId, user.workspaceId));
    await cleanupAuthData();
  });

  const buildDetailPayload = (name: string) => ({
    name,
    description: `${name} description`,
    problem: `${name} problem`,
    solution: `${name} solution`,
    domain: 'Operations',
    technologies: ['AI'],
    leadtime: '3 months',
    prerequisites: 'Data access',
    contact: 'team@example.com',
    benefits: ['Benefit'],
    metrics: ['Metric'],
    risks: ['Risk'],
    constraints: ['Constraint'],
    nextSteps: ['Next step'],
    dataSources: ['ERP'],
    dataObjects: ['Orders'],
    references: [{ title: 'Reference', url: 'https://example.com/reference' }],
    valueScores: defaultMatrixConfig.valueAxes.map((axis) => ({
      axisId: axis.id,
      rating: 70,
      description: `${axis.name} score`,
    })),
    complexityScores: defaultMatrixConfig.complexityAxes.map((axis) => ({
      axisId: axis.id,
      rating: 35,
      description: `${axis.name} score`,
    })),
  });

  const buildMatrixTemplate = () => ({
    valueAxes: defaultMatrixConfig.valueAxes.map((axis) => ({
      axisId: axis.id,
      levelDescriptions: [1, 2, 3, 4, 5].map((level) => ({
        level,
        description: `${axis.name} level ${level} dossier`,
      })),
    })),
    complexityAxes: defaultMatrixConfig.complexityAxes.map((axis) => ({
      axisId: axis.id,
      levelDescriptions: [1, 2, 3, 4, 5].map((level) => ({
        level,
        description: `${axis.name} level ${level} dossier`,
      })),
    })),
  });

  const drainWorkspaceQueue = async (workspaceId: string) => {
    while (true) {
      const pendingJobs = await db
        .select()
        .from(jobQueue)
        .where(and(eq(jobQueue.workspaceId, workspaceId), eq(jobQueue.status, 'pending')))
        .orderBy(asc(jobQueue.createdAt));

      if (pendingJobs.length === 0) break;

      for (const pendingJob of pendingJobs) {
        await db
          .update(jobQueue)
          .set({ status: 'processing', startedAt: new Date() })
          .where(eq(jobQueue.id, pendingJob.id));

        const [claimedJob] = await db
          .select()
          .from(jobQueue)
          .where(eq(jobQueue.id, pendingJob.id))
          .limit(1);

        await (queueManager as unknown as { processJob: (job: unknown) => Promise<void> }).processJob(claimedJob);
      }
    }
  };

  it('runs the multi-org workflow through list, detail fanout, and summary join from the generate endpoint', async () => {
    const organizationId = createTestId();
    await db.insert(organizations).values({
      id: organizationId,
      workspaceId: user.workspaceId,
      name: 'Org fanout',
      status: 'completed',
      data: {
        industry: 'Tech',
        size: '',
        products: '',
        processes: '',
        kpis: '',
        challenges: '',
        objectives: 'Grow pipeline',
        technologies: '',
        references: [],
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    vi.spyOn(contextInitiative, 'generateInitiativeList').mockResolvedValue({
      dossier: 'Runtime workflow folder',
      initiatives: [
        {
          titre: 'Initiative A',
          description: 'Initiative A short description',
          ref: '1. [Reference](https://example.com/a)',
        },
        {
          titre: 'Initiative B',
          description: 'Initiative B short description',
          ref: '1. [Reference](https://example.com/b)',
        },
      ],
    });

    vi.spyOn(contextInitiative, 'generateInitiativeDetail').mockImplementation(async (initiativeName) =>
      buildDetailPayload(String(initiativeName)),
    );

    vi.spyOn(executiveSummaryService, 'generateExecutiveSummary').mockImplementation(async ({ folderId }) => {
      await db
        .update(folders)
        .set({
          executiveSummary: JSON.stringify({
            introduction: 'Synthetic introduction',
            analyse: 'Synthetic analysis',
            recommandation: 'Synthetic recommendation',
            synthese_executive: 'Synthetic executive summary',
            references: [],
          }),
        })
        .where(eq(folders.id, folderId));
    });

    const response = await authenticatedRequest(
      app,
      'POST',
      '/api/v1/initiatives/generate',
      user.sessionToken!,
      {
        input: `Runtime workflow ${createTestId()}`,
        initiative_count: 2,
        org_ids: [organizationId],
        model: 'gpt-4.1-nano',
      },
    );

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(typeof data.workflow_run_id).toBe('string');
    expect(typeof data.jobId).toBe('string');

    await drainWorkspaceQueue(user.workspaceId!);

    const [run] = await db
      .select()
      .from(executionRuns)
      .where(eq(executionRuns.id, data.workflow_run_id))
      .limit(1);
    expect(run?.status).toBe('completed');

    const [runState] = await db
      .select()
      .from(workflowRunState)
      .where(eq(workflowRunState.runId, data.workflow_run_id))
      .limit(1);
    expect(runState?.status).toBe('completed');

    const [folder] = await db
      .select()
      .from(folders)
      .where(and(eq(folders.id, data.folder_id), eq(folders.workspaceId, user.workspaceId)))
      .limit(1);
    expect(folder?.status).toBe('completed');
    expect(folder?.executiveSummary).toBeTruthy();

    const initiativeRows = await db
      .select()
      .from(initiatives)
      .where(and(eq(initiatives.folderId, data.folder_id), eq(initiatives.workspaceId, user.workspaceId)));
    expect(initiativeRows).toHaveLength(2);
    expect(initiativeRows.every((row) => row.status === 'completed')).toBe(true);

    const detailTaskResults = await db
      .select({
        taskInstanceKey: workflowTaskResults.taskInstanceKey,
        status: workflowTaskResults.status,
      })
      .from(workflowTaskResults)
      .where(
        and(
          eq(workflowTaskResults.runId, data.workflow_run_id),
          eq(workflowTaskResults.taskKey, 'generation_usecase_detail'),
        ),
      );
    expect(detailTaskResults).toHaveLength(2);
    expect(detailTaskResults.every((row) => row.status === 'completed')).toBe(true);

    const [summaryTaskResult] = await db
      .select({
        status: workflowTaskResults.status,
      })
      .from(workflowTaskResults)
      .where(
        and(
          eq(workflowTaskResults.runId, data.workflow_run_id),
          eq(workflowTaskResults.taskKey, 'generation_executive_summary'),
          eq(workflowTaskResults.taskInstanceKey, 'main'),
        ),
      )
      .limit(1);
    expect(summaryTaskResult?.status).toBe('completed');

    const summaryJobs = await db
      .select({
        id: jobQueue.id,
        status: jobQueue.status,
      })
      .from(jobQueue)
      .where(and(eq(jobQueue.workspaceId, user.workspaceId), eq(jobQueue.type, 'executive_summary')));
    expect(summaryJobs).toHaveLength(1);
    expect(summaryJobs[0]?.status).toBe('completed');
  });

  it('generates an ad hoc folder matrix without a single linked organization', async () => {
    vi.spyOn(contextMatrix, 'generateOrganizationMatrixTemplate').mockResolvedValue(
      buildMatrixTemplate(),
    );

    vi.spyOn(contextInitiative, 'generateInitiativeList').mockResolvedValue({
      dossier: 'Folder matrix runtime',
      initiatives: [
        {
          titre: 'Initiative matrix',
          description: 'Initiative matrix short description',
          ref: '1. [Reference](https://example.com/matrix)',
        },
      ],
    });

    vi.spyOn(contextInitiative, 'generateInitiativeDetail').mockImplementation(async (initiativeName) =>
      buildDetailPayload(String(initiativeName)),
    );

    vi.spyOn(executiveSummaryService, 'generateExecutiveSummary').mockImplementation(async ({ folderId }) => {
      await db
        .update(folders)
        .set({
          executiveSummary: JSON.stringify({
            introduction: 'Synthetic introduction',
            analyse: 'Synthetic analysis',
            recommandation: 'Synthetic recommendation',
            synthese_executive: 'Synthetic executive summary',
            references: [],
          }),
        })
        .where(eq(folders.id, folderId));
    });

    const response = await authenticatedRequest(
      app,
      'POST',
      '/api/v1/initiatives/generate',
      user.sessionToken!,
      {
        input: `Digital twin manufacturier ${createTestId()}`,
        matrix_mode: 'generate',
        initiative_count: 1,
        model: 'gpt-4.1-nano',
      },
    );

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.matrix_mode).toBe('generate');
    expect(typeof data.matrixJobId).toBe('string');

    await drainWorkspaceQueue(user.workspaceId!);

    const [folder] = await db
      .select()
      .from(folders)
      .where(and(eq(folders.id, data.folder_id), eq(folders.workspaceId, user.workspaceId)))
      .limit(1);
    expect(folder).toBeDefined();
    expect(folder?.organizationId).toBeNull();
    expect(folder?.matrixConfig).toBeTruthy();
    expect(folder?.status).toBe('completed');

    const parsedMatrix = JSON.parse(folder!.matrixConfig!);
    expect(parsedMatrix.valueAxes[0]?.levelDescriptions?.[0]?.description).toContain('dossier');
  });

  it('runs the historical auto-create path list first, then organizations, then details', async () => {
    vi.spyOn(contextInitiative, 'generateInitiativeList').mockResolvedValue({
      dossier: 'Auto-create workflow folder',
      initiatives: [
        {
          titre: 'Initiative Alpha',
          description: 'Initiative Alpha short description',
          organizationName: 'Org Alpha',
          ref: '1. [Reference](https://example.com/alpha)',
        } as any,
        {
          titre: 'Initiative Beta',
          description: 'Initiative Beta short description',
          organizationName: 'Org Beta',
          ref: '1. [Reference](https://example.com/beta)',
        } as any,
      ],
    });

    vi.spyOn(contextOrganization, 'enrichOrganization').mockImplementation(async (organizationName) => ({
      industry: `Industry ${organizationName}`,
      size: '100-500',
      products: `${organizationName} products`,
      processes: `${organizationName} processes`,
      kpis: `${organizationName} KPIs`,
      challenges: `${organizationName} challenges`,
      objectives: `${organizationName} objectives`,
      technologies: `${organizationName} technologies`,
      references: [],
    }));

    vi.spyOn(contextMatrix, 'generateOrganizationMatrixTemplate').mockResolvedValue(
      buildMatrixTemplate(),
    );

    vi.spyOn(contextInitiative, 'generateInitiativeDetail').mockImplementation(async (initiativeName) =>
      buildDetailPayload(String(initiativeName)),
    );

    vi.spyOn(executiveSummaryService, 'generateExecutiveSummary').mockImplementation(async ({ folderId }) => {
      await db
        .update(folders)
        .set({
          executiveSummary: JSON.stringify({
            introduction: 'Synthetic introduction',
            analyse: 'Synthetic analysis',
            recommandation: 'Synthetic recommendation',
            synthese_executive: 'Synthetic executive summary',
            references: [],
          }),
        })
        .where(eq(folders.id, folderId));
    });

    const response = await authenticatedRequest(
      app,
      'POST',
      '/api/v1/initiatives/generate',
      user.sessionToken!,
      {
        input: `Auto-create org flow ${createTestId()}`,
        matrix_mode: 'generate',
        initiative_count: 2,
        create_new_orgs: true,
        model: 'gpt-4.1-nano',
      },
    );

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.matrix_mode).toBe('generate');
    expect(typeof data.workflow_run_id).toBe('string');

    await drainWorkspaceQueue(user.workspaceId!);

    const [run] = await db
      .select()
      .from(executionRuns)
      .where(eq(executionRuns.id, data.workflow_run_id))
      .limit(1);
    expect(run?.status).toBe('completed');

    const organizationRows = await db
      .select({ id: organizations.id, name: organizations.name, status: organizations.status })
      .from(organizations)
      .where(eq(organizations.workspaceId, user.workspaceId))
      .orderBy(asc(organizations.name));
    expect(organizationRows.map((row) => row.name)).toEqual(['Org Alpha', 'Org Beta']);
    expect(organizationRows.every((row) => row.status === 'completed')).toBe(true);

    const jobRows = await db
      .select({
        type: jobQueue.type,
        status: jobQueue.status,
      })
      .from(jobQueue)
      .where(eq(jobQueue.workspaceId, user.workspaceId))
      .orderBy(asc(jobQueue.createdAt));

    const jobTypesInOrder = jobRows.map((row) => row.type);
    expect(jobTypesInOrder[0]).toBe('initiative_list');
    expect(jobTypesInOrder).toContain('organization_batch_create');
    expect(jobTypesInOrder.filter((type) => type === 'organization_enrich')).toHaveLength(2);
    expect(jobTypesInOrder).toContain('organization_targets_join');
    expect(jobTypesInOrder).toContain('matrix_generate');
    expect(jobTypesInOrder.filter((type) => type === 'initiative_detail')).toHaveLength(2);
    expect(jobTypesInOrder).toContain('executive_summary');
    expect(jobTypesInOrder.indexOf('initiative_list')).toBeLessThan(jobTypesInOrder.indexOf('organization_batch_create'));
    expect(jobTypesInOrder.indexOf('organization_batch_create')).toBeLessThan(jobTypesInOrder.indexOf('organization_targets_join'));
    expect(jobTypesInOrder.indexOf('organization_targets_join')).toBeLessThan(jobTypesInOrder.indexOf('matrix_generate'));
    expect(jobTypesInOrder.indexOf('matrix_generate')).toBeLessThan(jobTypesInOrder.indexOf('initiative_detail'));

    const [runState] = await db
      .select()
      .from(workflowRunState)
      .where(eq(workflowRunState.runId, data.workflow_run_id))
      .limit(1);
    expect(runState?.status).toBe('completed');

    const runtimeState = (runState?.state ?? {}) as Record<string, any>;
    expect(runtimeState.orgContext?.effectiveOrgIds).toHaveLength(2);
    expect(runtimeState.generation?.initiatives).toHaveLength(2);
    expect(runtimeState.generation?.initiatives.every((initiative: any) => Array.isArray(initiative.organizationIds) && initiative.organizationIds.length === 1)).toBe(true);

    const detailTaskResults = await db
      .select({
        taskInstanceKey: workflowTaskResults.taskInstanceKey,
        status: workflowTaskResults.status,
      })
      .from(workflowTaskResults)
      .where(
        and(
          eq(workflowTaskResults.runId, data.workflow_run_id),
          eq(workflowTaskResults.taskKey, 'generation_usecase_detail'),
        ),
      );
    expect(detailTaskResults).toHaveLength(2);
    expect(detailTaskResults.every((row) => row.status === 'completed')).toBe(true);
  });
});
