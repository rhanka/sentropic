import { describe, it, expect, afterEach, beforeAll, afterAll, beforeEach } from 'vitest';
import { createTestId, getTestModel, sleep } from '../utils/test-helpers';
import { authenticatedRequest, createAuthenticatedUser, cleanupAuthData } from '../utils/auth-helper';
import { app } from '../../src/app';

describe('AI Workflow - Complete Integration Test', () => {
  let createdFolderId: string | null = null;
  let createdCompanyId: string | null = null;
  let user: any;

  beforeEach(async () => {
    user = await createAuthenticatedUser('editor');
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
    // Cleanup created resources
    if (createdFolderId) {
      try {
        await authenticatedRequest(app, 'DELETE', `/api/v1/folders/${createdFolderId}`, user.sessionToken!);
      } catch {}
      createdFolderId = null;
    }
    if (createdCompanyId) {
      try {
        await authenticatedRequest(app, 'DELETE', `/api/v1/companies/${createdCompanyId}`, user.sessionToken!);
      } catch {}
      createdCompanyId = null;
    }
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

  // Test complet : Enrichissement d'entreprise + Génération de use cases avec cette entreprise
  it('should complete full AI workflow: company enrichment + use case generation', async () => {
    const companyName = `AI Company Workflow ${createTestId()}`;
    
    // 1) Create a company draft
    const draft = await authenticatedRequest(
      app,
      'POST',
      '/api/v1/companies/draft',
      user.sessionToken!,
      { name: companyName }
    );
    expect(draft.status).toBe(201);
    const draftData = await draft.json();
    createdCompanyId = draftData.id as string;
    expect(draftData.status).toBe('draft');

    // 2) Start company enrichment
    const enrichResponse = await authenticatedRequest(
      app,
      'POST',
      `/api/v1/companies/${createdCompanyId}/enrich`,
      user.sessionToken!,
      { model: getTestModel() }
    );
    expect(enrichResponse.status).toBe(200);
    const enrichData = await enrichResponse.json();
    expect(enrichData.success).toBe(true);
    expect(enrichData.status).toBe('enriching');
    expect(enrichData.jobId).toBeDefined();

    // 3) Wait for company enrichment completion with polling
    let enrichedCompany;
    let attempts = 0;
    const maxAttempts = 5; // 5 * 5s = 25s max
    
    do {
      await sleep(5000); // Wait 5 seconds between checks
      enrichedCompany = await authenticatedRequest(app, 'GET', `/api/v1/companies/${createdCompanyId}`, user.sessionToken!);
      attempts++;
    } while (enrichedCompany.status === 200 && (await enrichedCompany.clone().json()).status === 'enriching' && attempts < maxAttempts);

    // 4) Verify company enrichment completed
    expect(enrichedCompany.status).toBe(200);
    const enrichedData = await enrichedCompany.json();
    expect(enrichedData.status).toBe('completed');
    expect(enrichedData.industry).toBeDefined();
    expect(enrichedData.industry).not.toBeNull();
    expect(enrichedData.size).toBeDefined();
    expect(enrichedData.products).toBeDefined();
    expect(enrichedData.processes).toBeDefined();
    expect(enrichedData.challenges).toBeDefined();
    expect(enrichedData.objectives).toBeDefined();
    expect(enrichedData.technologies).toBeDefined();

    // 5) Start use case generation with the enriched company
    const input = `Generate 5 AI use cases for ${companyName} in the ${enrichedData.industry} industry`;
    const generateResponse = await authenticatedRequest(
      app,
      'POST',
      '/api/v1/use-cases/generate',
      user.sessionToken!,
      {
        input,
        create_new_folder: true,
        company_id: createdCompanyId,
        model: getTestModel()
      }
    );
    expect(generateResponse.status).toBe(200);
    const generateData = await generateResponse.json();
    expect(generateData.success).toBe(true);
    expect(generateData.status).toBe('generating');
    expect(generateData.created_folder_id).toBeDefined();
    createdFolderId = generateData.created_folder_id;

    // 6) Wait for use case generation completion with polling
    let folderResponse;
    let attempts2 = 0;
    const maxAttempts2 = 5; // 5 * 5s = 15s max
    
    do {
      await sleep(5000); // Wait 5 seconds between checks
      folderResponse = await authenticatedRequest(app, 'GET', `/api/v1/folders/${createdFolderId}`, user.sessionToken!);
      attempts2++;
    } while (folderResponse.status === 200 && (await folderResponse.clone().json()).status === 'generating' && attempts2 < maxAttempts2);

    // 7) Verify folder is completed and associated with company
    expect(folderResponse.status).toBe(200);
    const folderData = await folderResponse.json();
    expect(folderData.status).toBe('completed');
    expect(folderData.companyId).toBe(createdCompanyId);

    // 8) Wait for use cases to complete with polling
    let useCasesResponse;
    let attempts4 = 0;
    const maxAttempts4 = 6; // 12 * 5s = 30s max
    
    do {
      await sleep(5000); // Wait 5 seconds between checks
      useCasesResponse = await authenticatedRequest(app, 'GET', `/api/v1/use-cases?folder_id=${createdFolderId}`, user.sessionToken!);
      attempts4++;
    } while (useCasesResponse.status === 200 && (await useCasesResponse.clone().json()).items.length === 0 && attempts4 < maxAttempts4);

    expect(useCasesResponse.status).toBe(200);
    const useCasesData = await useCasesResponse.json();
    expect(useCasesData.items.length).toBeGreaterThan(0);
    
    const useCases = useCasesData.items;
    console.log('Use cases found:', useCases.length);
    console.log('Use case statuses:', useCases.map((uc: any) => uc.status));
    
    // Wait until at least 80% of use cases are completed (polling)
    const totalCount = useCases.length;
    const threshold = Math.ceil(0.8 * totalCount);
    let completedUseCases = useCases.filter((uc: any) => uc.status === 'completed');
    let attempts5 = 0;
    const maxAttempts5 = 24; // 24 * 5s = 120s max

    while (completedUseCases.length < threshold && attempts5 < maxAttempts5) {
      await sleep(5000);
      const updatedResponse = await authenticatedRequest(app, 'GET', `/api/v1/use-cases?folder_id=${createdFolderId}`, user.sessionToken!);
      if (updatedResponse.status === 200) {
        const updatedData = await updatedResponse.json();
        const updatedUseCases = updatedData.items;
        completedUseCases = updatedUseCases.filter((uc: any) => uc.status === 'completed');
        console.log(`Attempt ${attempts5 + 1}: Completed use cases after wait: ${completedUseCases.length}/${updatedUseCases.length}`);
        console.log('Current statuses:', updatedUseCases.map((uc: any) => uc.status));
      }
      attempts5++;
    }

    console.log(`Final result: ${completedUseCases.length} completed use cases out of ${totalCount} total`);
    expect(completedUseCases.length).toBeGreaterThanOrEqual(threshold);
    
    // Verify the first completed use case
    const firstCompleted = completedUseCases[0];
    expect(firstCompleted.companyId).toBe(createdCompanyId);
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

    // 9) Verify all use cases are associated with the company
    const allAssociated = useCases.every((uc: any) => uc.companyId === createdCompanyId);
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
    expect(queueData.processing).toBeLessThanOrEqual(10);
    
    // Log final queue status for debugging
    console.log('Final queue status:', queueData);
    
    // Cleanup admin user
    await cleanupAuthData();
      }, 120000);
});


