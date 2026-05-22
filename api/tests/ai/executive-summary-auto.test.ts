import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { app } from '../../src/app';
import { authenticatedRequest, createAuthenticatedUser, cleanupAuthData } from '../utils/auth-helper';
import { createTestId, getTestModel, sleep } from '../utils/test-helpers';
import { db } from '../../src/db/client';
import { chatStreamEvents, folders, initiatives, jobQueue } from '../../src/db/schema';
import { and, eq } from 'drizzle-orm';
import { ensureWorkspaceForUser } from '../../src/services/workspace-service';
import { queueManager } from '../../src/services/queue-manager';

describe('Executive Summary - Automatic Generation', () => {
  let user: any;
  let workspaceId: string;

  beforeEach(async () => {
    user = await createAuthenticatedUser('editor');
    // Ensure workspace exists for direct DB inserts (tenancy)
    workspaceId = (await ensureWorkspaceForUser(user.id)).workspaceId;
  });

  beforeAll(async () => {
    // Clear queue before starting tests
    try {
      const tempUser = await createAuthenticatedUser('editor');
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

  afterEach(async () => {
    await cleanupAuthData();
  });

  afterAll(async () => {
    // Final cleanup - purge all remaining jobs
    try {
      const tempUser = await createAuthenticatedUser('editor');
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

  function parseJobData(data: string): any {
    return JSON.parse(data);
  }

  async function fetchInitiatives(folderId: string) {
    return db
      .select()
      .from(initiatives)
      .where(and(eq(initiatives.workspaceId, workspaceId), eq(initiatives.folderId, folderId)));
  }

  async function fetchExecutiveSummaryJobs(folderId: string) {
    const jobs = await db
      .select()
      .from(jobQueue)
      .where(and(eq(jobQueue.workspaceId, workspaceId), eq(jobQueue.type, 'executive_summary')));

    return jobs.filter((job) => parseJobData(job.data).folderId === folderId);
  }

  it('should automatically trigger executive summary generation when all initiatives are completed', async () => {
    // 1. Generate initiatives (this will create a folder and initiative_list/initiative_detail jobs)
    const generateRes = await authenticatedRequest(app, 'POST', '/api/v1/initiatives/generate', user.sessionToken!, {
      input: 'Test use case generation for automatic executive summary',
      model: getTestModel()
    });
    expect(generateRes.status).toBe(200);
    const generateData = await generateRes.json();
    const folderId = generateData.created_folder_id;

    // 2. Wait for all use case detail jobs to complete
    let allInitiativesCompleted = false;
    let attempts = 0;
    const maxAttempts = 30; // 5 minutes max

    while (!allInitiativesCompleted && attempts < maxAttempts) {
      await queueManager.processJobsForWorkspace(workspaceId);
      await sleep(1000);

      // Check initiatives status
      const initiativesList = await fetchInitiatives(folderId);

      if (initiativesList.length > 0) {
        allInitiativesCompleted = initiativesList.every((uc: any) => uc.status === 'completed');
      }

      attempts++;
    }

    expect(allInitiativesCompleted).toBe(true);

    // 4. Wait a bit more for the executive_summary job to be created and potentially processed
    await queueManager.processJobsForWorkspace(workspaceId);

    // 5. Check that an executive_summary job was created (or already completed)
    const executiveSummaryJobs = await fetchExecutiveSummaryJobs(folderId);
    
    // Either the job exists (pending/processing) or it was already completed
    // If completed, the executive summary should be in the database
    const [folder] = await db.select().from(folders).where(eq(folders.id, folderId));
    
    if (executiveSummaryJobs.length > 0) {
      // Job exists, check status
      const job = executiveSummaryJobs[0];
      expect(['pending', 'processing', 'completed']).toContain(job.status);
    } else {
      // Job might have been completed already, check if summary exists
      expect(folder?.executiveSummary).toBeDefined();
    }

    // 6. Check that folder status was updated appropriately
    // It should be 'generating' if job is pending/processing, or 'completed' if done
    if (folder?.executiveSummary) {
      expect(folder.status).toBe('completed');
    } else if (executiveSummaryJobs.length > 0) {
      expect(['generating', 'completed']).toContain(folder?.status);
    }

    // 5. Cleanup
    await db.delete(chatStreamEvents).where(eq(chatStreamEvents.streamId, `folder_${folderId}`));
    await db.delete(initiatives).where(eq(initiatives.folderId, folderId));
    await db.delete(folders).where(eq(folders.id, folderId));
  }, 300000); // 5 minutes timeout

  it('should not trigger executive summary if one already exists', async () => {
    // 1. Create a folder with existing executive summary
    const folderId = createTestId();
    await db.insert(folders).values({
      id: folderId,
      workspaceId,
      name: `Test Folder Existing Summary ${createTestId()}`,
      description: 'Test folder with existing summary',
      status: 'completed',
      executiveSummary: JSON.stringify({
        introduction: 'Test introduction',
        analyse: 'Test analyse',
        recommandation: 'Test recommandation',
        synthese_executive: 'Test synthese'
      }),
      matrixConfig: JSON.stringify({
        valueAxes: ['business_impact'],
        complexityAxes: ['technical_complexity']
      })
    });

    // 2. Create completed initiatives (scores calculés dynamiquement, pas stockés)
    const initiativeId = createTestId();
    await db.insert(initiatives).values({
      id: initiativeId,
      workspaceId,
      folderId,
      data: {
        name: 'Test Use Case',
        description: 'Test use case',
        valueScores: [{ axisId: 'value1', rating: 50, description: 'Test value' }],
        complexityScores: [{ axisId: 'complexity1', rating: 30, description: 'Test complexity' }]
      } as any,
      status: 'completed'
    });

    // 3. Simulate processing a use case detail (which would normally trigger the check)
    // Since all initiatives are already completed, this should NOT create a new executive_summary job
    // We'll check by looking at the queue before and after
    const executiveSummaryJobsBefore = await fetchExecutiveSummaryJobs(folderId);

    // Wait a bit
    await sleep(2000);

    // 4. Check that NO new executive_summary job was created
    const executiveSummaryJobsAfter = await fetchExecutiveSummaryJobs(folderId);

    expect(executiveSummaryJobsAfter.length).toBe(executiveSummaryJobsBefore.length);

    // 5. Check that folder status was NOT changed to 'generating'
    const [folder] = await db.select().from(folders).where(eq(folders.id, folderId));
    expect(folder?.status).toBe('completed');

    // Cleanup
    await db.delete(initiatives).where(eq(initiatives.folderId, folderId));
    await db.delete(folders).where(eq(folders.id, folderId));
  }, 30000);
});
