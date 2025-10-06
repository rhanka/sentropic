import { describe, it, expect, beforeEach } from 'vitest';
import { apiRequest, getTestModel, sleep } from '../utils/test-helpers';
import { testCompanies, testUseCases } from '../utils/test-data';

describe('Queue Manager', () => {
  it('should process company enrichment jobs', async () => {
    // Create a draft company
    const companyData = {
      name: testCompanies.forEnrichment.name,
    };

    const createResponse = await apiRequest('/companies/draft', {
      method: 'POST',
      body: JSON.stringify(companyData),
    });

    expect(createResponse.ok).toBe(true);
    const companyId = createResponse.data.id;

    // Start enrichment (adds job to queue)
    const enrichResponse = await apiRequest(`/companies/${companyId}/enrich`, {
      method: 'POST',
      body: JSON.stringify({ model: getTestModel() }),
    });

    expect(enrichResponse.ok).toBe(true);
    expect(enrichResponse.data.jobId).toBeDefined();

    // Wait for processing (queue needs more time)
    await sleep(20000);

    // Check if company was enriched
    const companyResponse = await apiRequest(`/companies/${companyId}`);
    expect(companyResponse.ok).toBe(true);
    expect(companyResponse.data.status).toBe('completed');
    expect(companyResponse.data.industry).toBeDefined();

    // Cleanup
    await apiRequest(`/companies/${companyId}`, { method: 'DELETE' });
  });

  it('should process use case generation jobs', async () => {
    const generateData = {
      input: testUseCases.forGeneration.input,
      create_new_folder: true,
      model: getTestModel(),
    };

    const response = await apiRequest('/use-cases/generate', {
      method: 'POST',
      body: JSON.stringify(generateData),
    });

    expect(response.ok).toBe(true);
    expect(response.data.jobId).toBeDefined();

    const folderId = response.data.created_folder_id;

    // Wait for processing (queue needs more time)
    await sleep(25000);

    // Check if use cases were generated and detailed
    const useCasesResponse = await apiRequest(`/use-cases?folder_id=${folderId}`);
    expect(useCasesResponse.ok).toBe(true);
    expect(useCasesResponse.data.items.length).toBeGreaterThan(0);

    // Check if use cases are completed (not draft)
    const useCases = useCasesResponse.data.items;
    const completedUseCases = useCases.filter((uc: any) => uc.status === 'completed');
    expect(completedUseCases.length).toBeGreaterThan(0);

    // Cleanup
    if (folderId) {
      await apiRequest(`/folders/${folderId}`, { method: 'DELETE' });
    }
  });

  it('should handle job failures gracefully', async () => {
    // Try to enrich with invalid data
    const enrichData = {
      name: '', // Invalid name
      model: getTestModel(),
    };

    const response = await apiRequest('/companies/ai-enrich', {
      method: 'POST',
      body: JSON.stringify(enrichData),
    });

    expect(response.ok).toBe(false);
    expect(response.status).toBe(400);
  });
});
