import { describe, it, expect, afterEach, beforeAll, afterAll, beforeEach } from 'vitest';
import { createTestId, getTestModel, sleep } from '../utils/test-helpers';
import { authenticatedRequest, createAuthenticatedUser, cleanupAuthData } from '../utils/auth-helper';
import { app } from '../../src/app';
import { db } from '../../src/db/client';
import { chatStreamEvents } from '../../src/db/schema';
import { eq, sql } from 'drizzle-orm';

describe('AI Workflow - Complete Integration Test', () => {
  let createdFolderId: string | null = null;
  let createdOrganizationId: string | null = null;
  let user: any;

  beforeEach(async () => {
    user = await createAuthenticatedUser('editor');
  });

  beforeAll(async () => {
    // Clear ALL jobs from queue (including zombie processing jobs from prior runs)
    await db.run(sql`DELETE FROM job_queue`);
  });

  afterEach(async () => {
    // Cleanup created resources
    if (createdFolderId) {
      try {
        await authenticatedRequest(app, 'DELETE', `/api/v1/folders/${createdFolderId}`, user.sessionToken!);
      } catch {}
      createdFolderId = null;
    }
    if (createdOrganizationId) {
      try {
        await authenticatedRequest(app, 'DELETE', `/api/v1/organizations/${createdOrganizationId}`, user.sessionToken!);
      } catch {}
      createdOrganizationId = null;
    }
    // Purge queue before cleaning auth data to avoid FK violations
    // (queue processor may still reference the user being deleted)
    await db.run(sql`DELETE FROM job_queue`);
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
    createdOrganizationId = draftData.id as string;
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
    let enrichedOrganization;
    let attempts = 0;
    const maxAttempts = 5; // 5 * 5s = 25s max
    
    do {
      await sleep(5000); // Wait 5 seconds between checks
      enrichedOrganization = await authenticatedRequest(app, 'GET', `/api/v1/organizations/${createdOrganizationId}`, user.sessionToken!);
      attempts++;
    } while (enrichedOrganization.status === 200 && (await enrichedOrganization.clone().json()).status === 'enriching' && attempts < maxAttempts);

    // 4) Verify organization enrichment completed
    expect(enrichedOrganization.status).toBe(200);
    const enrichedData = await enrichedOrganization.json();
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
    const input = `Generate 5 AI initiatives for ${organizationName} in the ${enrichedData.industry} industry`;
    const generateResponse = await authenticatedRequest(
      app,
      'POST',
      '/api/v1/initiatives/generate',
      user.sessionToken!,
      {
        input,
        organization_id: createdOrganizationId,
        model: getTestModel()
      }
    );
    expect(generateResponse.status).toBe(200);
    const generateData = await generateResponse.json();
    expect(generateData.success).toBe(true);
    expect(generateData.status).toBe('generating');
    expect(generateData.created_folder_id).toBeDefined();
    createdFolderId = generateData.created_folder_id;

    // 6) Wait for initiative generation completion with polling
    let folderResponse;
    let attempts2 = 0;
    const maxAttempts2 = 5; // 5 * 5s = 15s max
    
    do {
      await sleep(5000); // Wait 5 seconds between checks
      folderResponse = await authenticatedRequest(app, 'GET', `/api/v1/folders/${createdFolderId}`, user.sessionToken!);
      attempts2++;
    } while (folderResponse.status === 200 && (await folderResponse.clone().json()).status === 'generating' && attempts2 < maxAttempts2);

    // 7) Verify folder is completed and associated with organization
    expect(folderResponse.status).toBe(200);
    const folderData = await folderResponse.json();
    expect(folderData.status).toBe('completed');
    expect(folderData.organizationId).toBe(createdOrganizationId);

    // 8) Wait for initiatives to complete with polling
    let initiativesResponse;
    let attempts4 = 0;
    const maxAttempts4 = 6; // 12 * 5s = 30s max
    
    do {
      await sleep(5000); // Wait 5 seconds between checks
      initiativesResponse = await authenticatedRequest(app, 'GET', `/api/v1/initiatives?folder_id=${createdFolderId}`, user.sessionToken!);
      attempts4++;
    } while (initiativesResponse.status === 200 && (await initiativesResponse.clone().json()).items.length === 0 && attempts4 < maxAttempts4);

    expect(initiativesResponse.status).toBe(200);
    const initiativesData = await initiativesResponse.json();
    expect(initiativesData.items.length).toBeGreaterThan(0);
    
    const initiatives = initiativesData.items;
    console.log('Initiatives found:', initiatives.length);
    console.log('Use case statuses:', initiatives.map((uc: any) => uc.status));
    
    // Wait until at least 80% of initiatives are completed (polling)
    const totalCount = initiatives.length;
    const threshold = Math.ceil(0.8 * totalCount);
    let completedInitiatives = initiatives.filter((uc: any) => uc.status === 'completed');
    let attempts5 = 0;
    const maxAttempts5 = 24; // 24 * 5s = 120s max

    while (completedInitiatives.length < threshold && attempts5 < maxAttempts5) {
      await sleep(5000);
      const updatedResponse = await authenticatedRequest(app, 'GET', `/api/v1/initiatives?folder_id=${createdFolderId}`, user.sessionToken!);
      if (updatedResponse.status === 200) {
        const updatedData = await updatedResponse.json();
        const updatedInitiatives = updatedData.items;
        completedInitiatives = updatedInitiatives.filter((uc: any) => uc.status === 'completed');
        console.log(`Attempt ${attempts5 + 1}: Completed initiatives after wait: ${completedInitiatives.length}/${updatedInitiatives.length}`);
        console.log('Current statuses:', updatedInitiatives.map((uc: any) => uc.status));
      }
      attempts5++;
    }

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
    let queueStats;
    let attempts3 = 0;
    const maxAttempts3 = 10;
    
    // Create admin user for queue stats access
    const adminUser = await createAuthenticatedUser('admin_app');
    
    do {
      await sleep(5000); // Wait 5 seconds between checks
      queueStats = await authenticatedRequest(app, 'GET', '/api/v1/queue/stats', adminUser.sessionToken!);
      attempts3++;
    } while (queueStats.status === 200 && ((await queueStats.clone().json()).pending > 0 || (await queueStats.clone().json()).processing > 0) && attempts3 < maxAttempts3);
    
    expect(queueStats.status).toBe(200);
    const queueData = await queueStats.json();
    expect(queueData.pending).toBe(0);
    // Allow some jobs to still be processing (they might be finishing up)
    // Note: Can be higher due to multiple initiative detail jobs running in parallel
    expect(queueData.processing).toBeLessThanOrEqual(30);
    
    // Log final queue status for debugging
    console.log('Final queue status:', queueData);
    
    // Cleanup admin user
    await cleanupAuthData();

    // Cleanup stream events
    await db.delete(chatStreamEvents).where(eq(chatStreamEvents.streamId, folderStreamId));
    await db.delete(chatStreamEvents).where(eq(chatStreamEvents.streamId, initiativeStreamId));
      }, 120000);
});


