import { describe, it, expect, afterEach, beforeAll, afterAll } from 'vitest';
import { apiRequest, createTestId, getTestModel, sleep } from '../utils/test-helpers';

describe('AI Workflow - Complete Integration Test', () => {
  let createdFolderId: string | null = null;
  let createdCompanyId: string | null = null;

  beforeAll(async () => {
    // Clear queue before starting tests
    try {
      await apiRequest('/queue/purge', {
        method: 'POST',
        body: JSON.stringify({ status: 'force' })
      });
    } catch {}
  });

  afterEach(async () => {
    // Cleanup created resources
    if (createdFolderId) {
      try {
        await apiRequest(`/folders/${createdFolderId}`, { method: 'DELETE' });
      } catch {}
      createdFolderId = null;
    }
    if (createdCompanyId) {
      try {
        await apiRequest(`/companies/${createdCompanyId}`, { method: 'DELETE' });
      } catch {}
      createdCompanyId = null;
    }
  });

  afterAll(async () => {
    // Final cleanup - purge all remaining jobs
    try {
      await apiRequest('/queue/purge', {
        method: 'POST',
        body: JSON.stringify({ status: 'force' })
      });
    } catch {}
  });

  // Test complet : Enrichissement d'entreprise + Génération de use cases avec cette entreprise
  it('should complete full AI workflow: company enrichment + use case generation', async () => {
    const companyName = `AI Company Workflow ${createTestId()}`;
    
    // 1) Create a company draft
    const draft = await apiRequest('/api/v1/companies/draft', {
      method: 'POST',
      body: JSON.stringify({ name: companyName })
    });
    expect(draft.ok).toBe(true);
    createdCompanyId = draft.data.id as string;
    expect(draft.data.status).toBe('draft');

    // 2) Start company enrichment
    const enrichResponse = await apiRequest(`/api/v1/companies/${createdCompanyId}/enrich`, {
      method: 'POST',
      body: JSON.stringify({ model: getTestModel() })
    });
    expect(enrichResponse.ok).toBe(true);
    expect(enrichResponse.data.success).toBe(true);
    expect(enrichResponse.data.status).toBe('enriching');
    expect(enrichResponse.data.jobId).toBeDefined();

    // 3) Wait for company enrichment completion with polling
    let enrichedCompany;
    let attempts = 0;
    const maxAttempts = 12; // 12 * 5s = 60s max
    
    do {
      await sleep(5000); // Wait 5 seconds between checks
      enrichedCompany = await apiRequest(`/api/v1/companies/${createdCompanyId}`);
      attempts++;
    } while (enrichedCompany.ok && enrichedCompany.data.status === 'enriching' && attempts < maxAttempts);

    // 4) Verify company enrichment completed
    expect(enrichedCompany.ok).toBe(true);
    expect(enrichedCompany.data.status).toBe('completed');
    expect(enrichedCompany.data.industry).toBeDefined();
    expect(enrichedCompany.data.industry).not.toBeNull();
    expect(enrichedCompany.data.size).toBeDefined();
    expect(enrichedCompany.data.products).toBeDefined();
    expect(enrichedCompany.data.processes).toBeDefined();
    expect(enrichedCompany.data.challenges).toBeDefined();
    expect(enrichedCompany.data.objectives).toBeDefined();
    expect(enrichedCompany.data.technologies).toBeDefined();

    // 5) Start use case generation with the enriched company
    const input = `Generate AI use cases for ${companyName} in the ${enrichedCompany.data.industry} industry`;
    const generateResponse = await apiRequest('/api/v1/use-cases/generate', {
      method: 'POST',
      body: JSON.stringify({
        input,
        create_new_folder: true,
        company_id: createdCompanyId,
        model: getTestModel()
      })
    });
    expect(generateResponse.ok).toBe(true);
    expect(generateResponse.data.success).toBe(true);
    expect(generateResponse.data.status).toBe('generating');
    expect(generateResponse.data.created_folder_id).toBeDefined();
    createdFolderId = generateResponse.data.created_folder_id;

    // 6) Wait for use case generation completion with polling
    let folderResponse;
    let attempts2 = 0;
    const maxAttempts2 = 12; // 12 * 5s = 60s max
    
    do {
      await sleep(5000); // Wait 5 seconds between checks
      folderResponse = await apiRequest(`/api/v1/folders/${createdFolderId}`);
      attempts2++;
    } while (folderResponse.ok && folderResponse.data.status === 'generating' && attempts2 < maxAttempts2);

    // 7) Verify folder is completed and associated with company
    expect(folderResponse.ok).toBe(true);
    expect(folderResponse.data.status).toBe('completed');
    expect(folderResponse.data.companyId).toBe(createdCompanyId);

    // 8) Wait for use cases to complete with polling
    let useCasesResponse;
    let attempts4 = 0;
    const maxAttempts4 = 12; // 12 * 5s = 60s max
    
    do {
      await sleep(5000); // Wait 5 seconds between checks
      useCasesResponse = await apiRequest(`/api/v1/use-cases?folder_id=${createdFolderId}`);
      attempts4++;
    } while (useCasesResponse.ok && useCasesResponse.data.items.length === 0 && attempts4 < maxAttempts4);

    expect(useCasesResponse.ok).toBe(true);
    expect(useCasesResponse.data.items.length).toBeGreaterThan(0);
    
    const useCases = useCasesResponse.data.items;
    console.log('Use cases found:', useCases.length);
    console.log('Use case statuses:', useCases.map((uc: any) => uc.status));
    
    // Wait for at least one use case to complete
    let completedUseCases = useCases.filter((uc: any) => uc.status === 'completed');
    let attempts5 = 0;
    const maxAttempts5 = 20; // 20 * 5s = 100s max
    
    while (completedUseCases.length === 0 && attempts5 < maxAttempts5) {
      await sleep(5000);
      const updatedResponse = await apiRequest(`/api/v1/use-cases?folder_id=${createdFolderId}`);
      if (updatedResponse.ok) {
        const updatedUseCases = updatedResponse.data.items;
        completedUseCases = updatedUseCases.filter((uc: any) => uc.status === 'completed');
        console.log(`Attempt ${attempts5 + 1}: Completed use cases after wait: ${completedUseCases.length}/${updatedUseCases.length}`);
        console.log('Current statuses:', updatedUseCases.map((uc: any) => uc.status));
      }
      attempts5++;
    }
    
    console.log(`Final result: ${completedUseCases.length} completed use cases out of ${useCases.length} total`);
    expect(completedUseCases.length).toBeGreaterThan(0);
    
    // Verify the first completed use case
    const firstCompleted = completedUseCases[0];
    expect(firstCompleted.companyId).toBe(createdCompanyId);
    expect(firstCompleted.name).toBeDefined();
    expect(firstCompleted.description).toBeDefined();
    expect(firstCompleted.valueScores).toBeDefined();
    expect(firstCompleted.complexityScores).toBeDefined();

    // 9) Verify all use cases are associated with the company
    const allAssociated = useCases.every((uc: any) => uc.companyId === createdCompanyId);
    expect(allAssociated).toBe(true);

    // 10) Wait for all jobs to complete and verify queue is clean
    let queueStats;
    let attempts3 = 0;
    const maxAttempts3 = 10;
    
    do {
      await sleep(5000); // Wait 5 seconds between checks
      queueStats = await apiRequest('/api/v1/queue/stats');
      attempts3++;
    } while (queueStats.ok && (queueStats.data.pending > 0 || queueStats.data.processing > 0) && attempts3 < maxAttempts3);
    
    expect(queueStats.ok).toBe(true);
    expect(queueStats.data.pending).toBe(0);
    // Allow some jobs to still be processing (they might be finishing up)
    expect(queueStats.data.processing).toBeLessThanOrEqual(2);
    
    // Log final queue status for debugging
    console.log('Final queue status:', queueStats.data);
      }, 120000);
});


