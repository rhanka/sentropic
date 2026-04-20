import { describe, it, expect, afterEach, beforeAll, afterAll, beforeEach } from 'vitest';
import { createTestId, getTestModel, sleep } from '../utils/test-helpers';
import { authenticatedRequest, createAuthenticatedUser, cleanupAuthData } from '../utils/auth-helper';
import { app } from '../../src/app';
import { db } from '../../src/db/client';
import { chatStreamEvents, jobQueue, workflowTaskResults } from '../../src/db/schema';
import { and, desc, eq, sql } from 'drizzle-orm';
import { queueManager } from '../../src/services/queue-manager';

type AsyncFailureScope = {
  workspaceId?: string | null;
  workflowRunId?: string;
};

type PollResult<T> = {
  done: boolean;
  value: T;
};

const POLL_INTERVAL_MS = 1000;
const FULL_WORKFLOW_INITIATIVE_COUNT = 3;
const ORG_AWARE_INITIATIVE_COUNT = 3;

function compact(value: string, maxLength = 800): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength)}...`;
}

function stringifyForError(value: unknown): string {
  try {
    return compact(JSON.stringify(value));
  } catch {
    return String(value);
  }
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function jobBelongsToWorkflow(jobData: string, workflowRunId: string): boolean {
  const parsed = parseJsonObject(jobData);
  const workflow = parsed?.workflow;
  return Boolean(
    workflow &&
      typeof workflow === 'object' &&
      !Array.isArray(workflow) &&
      (workflow as { workflowRunId?: unknown }).workflowRunId === workflowRunId
  );
}

async function assertNoAsyncFailures(scope: AsyncFailureScope): Promise<void> {
  if (scope.workflowRunId) {
    const failedTasks = await db
      .select({
        taskKey: workflowTaskResults.taskKey,
        taskInstanceKey: workflowTaskResults.taskInstanceKey,
        lastError: workflowTaskResults.lastError,
      })
      .from(workflowTaskResults)
      .where(and(eq(workflowTaskResults.runId, scope.workflowRunId), eq(workflowTaskResults.status, 'failed')));

    if (failedTasks.length > 0) {
      throw new Error(
        `Workflow ${scope.workflowRunId} failed: ${failedTasks
          .map((task) => `${task.taskKey}/${task.taskInstanceKey}: ${stringifyForError(task.lastError)}`)
          .join('; ')}`
      );
    }
  }

  if (!scope.workspaceId) return;

  const failedJobs = await db
    .select({
      id: jobQueue.id,
      type: jobQueue.type,
      error: jobQueue.error,
      data: jobQueue.data,
    })
    .from(jobQueue)
    .where(and(eq(jobQueue.workspaceId, scope.workspaceId), eq(jobQueue.status, 'failed')))
    .orderBy(desc(jobQueue.createdAt));

  const relevantFailedJobs = scope.workflowRunId
    ? failedJobs.filter((job) => jobBelongsToWorkflow(job.data, scope.workflowRunId!))
    : failedJobs;

  if (relevantFailedJobs.length > 0) {
    throw new Error(
      `Async job failed: ${relevantFailedJobs
        .map((job) => `${job.type}/${job.id}: ${job.error ?? 'Unknown error'}`)
        .join('; ')}`
    );
  }
}

async function waitFor<T>(
  description: string,
  options: {
    timeoutMs: number;
    intervalMs?: number;
    failureScope?: AsyncFailureScope;
  },
  read: () => Promise<PollResult<T>>
): Promise<T> {
  const deadline = Date.now() + options.timeoutMs;
  let lastValue: T | undefined;

  while (true) {
    if (options.failureScope) {
      await assertNoAsyncFailures(options.failureScope);
    }

    const result = await read();
    lastValue = result.value;
    if (result.done) return result.value;

    if (Date.now() >= deadline) {
      throw new Error(
        `Timed out waiting for ${description} after ${options.timeoutMs}ms. Last value: ${stringifyForError(lastValue)}`
      );
    }

    await sleep(Math.min(options.intervalMs ?? POLL_INTERVAL_MS, Math.max(1, deadline - Date.now())));
  }
}

async function fetchInitiatives(folderId: string, sessionToken: string): Promise<any[]> {
  const initiativesResponse = await authenticatedRequest(app, 'GET', `/api/v1/initiatives?folder_id=${folderId}`, sessionToken);
  expect(initiativesResponse.status).toBe(200);
  const initiativesData = await initiativesResponse.json();
  return initiativesData.items;
}

async function hardResetQueue(): Promise<void> {
  queueManager.pause();
  try {
    await queueManager.cancelAllProcessing('test-cleanup');
    await db.run(sql`DELETE FROM job_queue`);
  } finally {
    queueManager.resume();
  }
}

describe('AI Workflow - Complete Integration Test', () => {
  let createdFolderId: string | null = null;
  let createdOrganizationIds: string[] = [];
  let user: any;

  beforeEach(async () => {
    user = await createAuthenticatedUser('editor');
  });

  beforeAll(async () => {
    await hardResetQueue();
  });

  afterEach(async () => {
    await hardResetQueue();
    // Cleanup created resources
    if (createdFolderId) {
      try {
        await authenticatedRequest(app, 'DELETE', `/api/v1/folders/${createdFolderId}`, user.sessionToken!);
      } catch {}
      createdFolderId = null;
    }
    for (const organizationId of createdOrganizationIds) {
      try {
        await authenticatedRequest(app, 'DELETE', `/api/v1/organizations/${organizationId}`, user.sessionToken!);
      } catch {}
    }
    createdOrganizationIds = [];
    await cleanupAuthData();
  });

  afterAll(async () => {
    // Final cleanup - purge all remaining jobs
    try {
      const tempUser = await createAuthenticatedUser('admin_app');
      await authenticatedRequest(
        app,
        'POST',
        '/api/v1/queue/purge',
        tempUser.sessionToken!,
        { status: 'force' }
      );
      await cleanupAuthData();
    } catch {}
  });

  // Test complet : Enrichissement d'organisation + Génération de initiatives avec cette organisation
  it('should complete full AI workflow: organization enrichment + initiative generation', async () => {
    const organizationName = `AI Organization Workflow ${createTestId()}`;
    
    // 1) Create an organization draft
    const draft = await authenticatedRequest(
      app,
      'POST',
      '/api/v1/organizations/draft',
      user.sessionToken!,
      { name: organizationName }
    );
    expect(draft.status).toBe(201);
    const draftData = await draft.json();
    const createdOrganizationId = draftData.id as string;
    createdOrganizationIds = [createdOrganizationId];
    expect(draftData.status).toBe('draft');

    // 2) Start organization enrichment
    const enrichResponse = await authenticatedRequest(
      app,
      'POST',
      `/api/v1/organizations/${createdOrganizationId}/enrich`,
      user.sessionToken!,
      { model: getTestModel() }
    );
    expect(enrichResponse.status).toBe(200);
    const enrichData = await enrichResponse.json();
    expect(enrichData.success).toBe(true);
    expect(enrichData.status).toBe('enriching');
    expect(enrichData.jobId).toBeDefined();

    // 3) Wait for organization enrichment completion with polling
    const enrichedState = await waitFor(
      'organization enrichment',
      { timeoutMs: 45000, failureScope: { workspaceId: user.workspaceId } },
      async () => {
        const response = await authenticatedRequest(app, 'GET', `/api/v1/organizations/${createdOrganizationId}`, user.sessionToken!);
        const data = response.status === 200 ? await response.json() : { httpStatus: response.status };
        return { done: response.status !== 200 || data.status !== 'enriching', value: { response, data } };
      }
    );

    // 4) Verify organization enrichment completed
    expect(enrichedState.response.status).toBe(200);
    const enrichedData = enrichedState.data;
    expect(enrichedData.status).toBe('completed');
    expect(enrichedData.industry).toBeDefined();
    expect(enrichedData.industry).not.toBeNull();
    expect(enrichedData.size).toBeDefined();
    expect(enrichedData.products).toBeDefined();
    expect(enrichedData.processes).toBeDefined();
    expect(enrichedData.challenges).toBeDefined();
    expect(enrichedData.objectives).toBeDefined();
    expect(enrichedData.technologies).toBeDefined();

    // 5) Start initiative generation with the enriched organization
    const input = `Generate ${FULL_WORKFLOW_INITIATIVE_COUNT} AI initiative for ${organizationName} in the ${enrichedData.industry} industry`;
    const generateResponse = await authenticatedRequest(
      app,
      'POST',
      '/api/v1/initiatives/generate',
      user.sessionToken!,
      {
        input,
        initiative_count: FULL_WORKFLOW_INITIATIVE_COUNT,
        organization_id: createdOrganizationId,
        model: getTestModel()
      }
    );
    expect(generateResponse.status).toBe(200);
    const generateData = await generateResponse.json();
    expect(generateData.success).toBe(true);
    expect(generateData.status).toBe('generating');
    expect(generateData.created_folder_id).toBeDefined();
    expect(typeof generateData.workflow_run_id).toBe('string');
    createdFolderId = generateData.created_folder_id;
    const workflowRunId = generateData.workflow_run_id as string;

    // 6) Verify folder exists and stays attached to the organization while the workflow continues
    const folderResponse = await authenticatedRequest(app, 'GET', `/api/v1/folders/${createdFolderId}`, user.sessionToken!);
    expect(folderResponse.status).toBe(200);
    const folderData = await folderResponse.json();
    expect(['generating', 'completed']).toContain(folderData.status);
    expect(folderData.organizationId).toBe(createdOrganizationId);

    // 7) Wait for list generation to create initiatives
    const initiatives = await waitFor(
      'initiative list creation',
      { timeoutMs: 45000, failureScope: { workspaceId: user.workspaceId, workflowRunId } },
      async () => {
        const items = await fetchInitiatives(createdFolderId!, user.sessionToken!);
        return { done: items.length > 0, value: items };
      }
    );

    expect(initiatives.length).toBeGreaterThan(0);
    console.log('Initiatives found:', initiatives.length);
    console.log('Use case statuses:', initiatives.map((uc: any) => uc.status));
    
    // 8) Wait until at least 80% of initiatives are completed
    const totalCount = initiatives.length;
    const threshold = Math.ceil(0.8 * totalCount);
    const completedState = await waitFor(
      'initiative detail completion threshold',
      { timeoutMs: 120000, failureScope: { workspaceId: user.workspaceId, workflowRunId } },
      async () => {
        const updatedInitiatives = await fetchInitiatives(createdFolderId!, user.sessionToken!);
        const completed = updatedInitiatives.filter((uc: any) => uc.status === 'completed');
        console.log(`Completed initiatives after wait: ${completed.length}/${updatedInitiatives.length}`);
        console.log('Current statuses:', updatedInitiatives.map((uc: any) => uc.status));
        return {
          done: completed.length >= threshold,
          value: { completed, updatedInitiatives },
        };
      }
    );
    const completedInitiatives = completedState.completed;

    console.log(`Final result: ${completedInitiatives.length} completed initiatives out of ${totalCount} total`);
    expect(completedInitiatives.length).toBeGreaterThanOrEqual(threshold);
    
    // Verify the first completed initiative
    const firstCompleted = completedInitiatives[0];
    expect(firstCompleted.organizationId).toBe(createdOrganizationId);
    // name and description are now in data JSONB
    expect(firstCompleted.data?.name).toBeDefined();
    expect(firstCompleted.data?.description).toBeDefined();
    expect(firstCompleted.data?.valueScores).toBeDefined();
    expect(firstCompleted.data?.complexityScores).toBeDefined();
    // Scores are calculated dynamically
    expect(firstCompleted.totalValueScore).toBeDefined();
    expect(firstCompleted.totalComplexityScore).toBeDefined();
    // Model field should be present and match the model used for generation
    expect(firstCompleted.model).toBeDefined();
    expect(firstCompleted.model).toBe(getTestModel());

    // Vérifier que les événements sont écrits dans chat_stream_events pour initiative-list
    const folderStreamId = `folder_${createdFolderId}`;
    const folderStreamEvents = await db
      .select()
      .from(chatStreamEvents)
      .where(eq(chatStreamEvents.streamId, folderStreamId))
      .orderBy(chatStreamEvents.sequence);
    
    expect(folderStreamEvents.length).toBeGreaterThan(0);
    folderStreamEvents.forEach(event => {
      expect(event.messageId).toBeNull(); // Générations classiques
    });
    const folderEventTypes = folderStreamEvents.map(e => e.eventType);
    expect(folderEventTypes).toContain('content_delta');
    expect(folderEventTypes).toContain('done');

    // Vérifier que les événements sont écrits dans chat_stream_events pour au moins un initiative-detail
    const initiativeId = firstCompleted.id;
    const initiativeStreamId = `initiative_${initiativeId}`;
    const initiativeStreamEvents = await db
      .select()
      .from(chatStreamEvents)
      .where(eq(chatStreamEvents.streamId, initiativeStreamId))
      .orderBy(chatStreamEvents.sequence);
    
    expect(initiativeStreamEvents.length).toBeGreaterThan(0);
    initiativeStreamEvents.forEach(event => {
      expect(event.messageId).toBeNull(); // Générations classiques
    });
    const initiativeEventTypes = initiativeStreamEvents.map(e => e.eventType);
    expect(initiativeEventTypes).toContain('content_delta');
    expect(initiativeEventTypes).toContain('done');

    // 9) Verify all initiatives are associated with the organization
    const allAssociated = initiatives.every((uc: any) => uc.organizationId === createdOrganizationId);
    expect(allAssociated).toBe(true);

    // 10) Wait for all jobs to complete and verify queue is clean
    const queueData = await waitFor(
      'queue idle',
      { timeoutMs: 60000, failureScope: { workspaceId: user.workspaceId, workflowRunId } },
      async () => {
        const queueStats = await authenticatedRequest(app, 'GET', '/api/v1/queue/stats', user.sessionToken!);
        expect(queueStats.status).toBe(200);
        const data = await queueStats.json();
        return { done: data.pending === 0 && data.processing === 0, value: data };
      }
    );

    expect(queueData.pending).toBe(0);
    expect(queueData.processing).toBe(0);
    expect(queueData.failed).toBe(0);
    
    // Log final queue status for debugging
    console.log('Final queue status:', queueData);

    const finalFolderData = await waitFor(
      'folder completion',
      { timeoutMs: 12000, failureScope: { workspaceId: user.workspaceId, workflowRunId } },
      async () => {
        const finalFolderResponse = await authenticatedRequest(app, 'GET', `/api/v1/folders/${createdFolderId}`, user.sessionToken!);
        expect(finalFolderResponse.status).toBe(200);
        const data = await finalFolderResponse.json();
        return { done: data.status === 'completed', value: data };
      }
    );
    expect(finalFolderData.status).toBe('completed');
    
    // Cleanup stream events
    await db.delete(chatStreamEvents).where(eq(chatStreamEvents.streamId, folderStreamId));
    await db.delete(chatStreamEvents).where(eq(chatStreamEvents.streamId, initiativeStreamId));
      }, 120000);

  it('should accept the org-aware list schema with explicit org_ids', async () => {
    const orgAlphaResponse = await authenticatedRequest(
      app,
      'POST',
      '/api/v1/organizations',
      user.sessionToken!,
      { name: `Org aware Alpha ${createTestId()}`, industry: 'Manufacturing' }
    );
    expect(orgAlphaResponse.status).toBe(201);
    const orgAlpha = await orgAlphaResponse.json();

    const orgBetaResponse = await authenticatedRequest(
      app,
      'POST',
      '/api/v1/organizations',
      user.sessionToken!,
      { name: `Org aware Beta ${createTestId()}`, industry: 'Logistics' }
    );
    expect(orgBetaResponse.status).toBe(201);
    const orgBeta = await orgBetaResponse.json();

    createdOrganizationIds = [orgAlpha.id, orgBeta.id];

    const generateResponse = await authenticatedRequest(
      app,
      'POST',
      '/api/v1/initiatives/generate',
      user.sessionToken!,
      {
        input: `Generate ${ORG_AWARE_INITIATIVE_COUNT} AI initiatives spanning manufacturing and logistics operations`,
        initiative_count: ORG_AWARE_INITIATIVE_COUNT,
        org_ids: createdOrganizationIds,
        matrix_mode: 'default',
        model: getTestModel(),
      }
    );
    expect(generateResponse.status).toBe(200);
    const generateData = await generateResponse.json();
    expect(generateData.success).toBe(true);
    expect(generateData.created_folder_id).toBeDefined();
    expect(typeof generateData.workflow_run_id).toBe('string');
    createdFolderId = generateData.created_folder_id;
    const workflowRunId = generateData.workflow_run_id as string;

    const generatedInitiatives = await waitFor(
      'org-aware initiative list creation',
      { timeoutMs: 90000, failureScope: { workspaceId: user.workspaceId, workflowRunId } },
      async () => {
        const items = await fetchInitiatives(createdFolderId!, user.sessionToken!);
        return { done: items.length > 0, value: items };
      }
    );

    expect(generatedInitiatives.length).toBeGreaterThan(0);
    const firstGenerated = generatedInitiatives[0];
    // organizationId may be null when the LLM returns organizationIds: [] (valid per prompt contract)
    // When assigned, it must reference one of the provided org IDs
    if (firstGenerated.organizationId) {
      expect(createdOrganizationIds).toContain(firstGenerated.organizationId);
    }
    // At least one initiative across the batch should have an org assigned
    const anyWithOrg = generatedInitiatives.some((i: any) => i.organizationId != null);
    expect(anyWithOrg).toBe(true);
    expect(firstGenerated.data?.name).toBeDefined();
    expect(firstGenerated.data?.description).toBeDefined();
  }, 180000);
});
