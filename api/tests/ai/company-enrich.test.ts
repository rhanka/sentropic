import { describe, it, expect } from 'vitest';
import { apiRequest, getTestModel } from '../utils/test-helpers';
import { testCompanies } from '../utils/test-data';

describe('Company AI Enrichment', () => {
  it('should enrich a company with AI', async () => {
    const enrichData = {
      name: testCompanies.forEnrichment.name,
      model: getTestModel(),
    };

    const response = await apiRequest('/companies/ai-enrich', {
      method: 'POST',
      body: JSON.stringify(enrichData),
    });

    expect(response.ok).toBe(true);
    if (!response.ok) {
      console.error('API Error:', response.error);
      console.error('Response:', response.data);
    }
    expect(response.data.industry).toBeDefined();
    expect(response.data.products).toBeDefined();
    expect(response.data.processes).toBeDefined();
    expect(response.data.challenges).toBeDefined();
    expect(response.data.objectives).toBeDefined();
    expect(response.data.technologies).toBeDefined();
  });

  it('should enrich a company asynchronously with queue', async () => {
    // First create a draft company
    const companyData = {
      name: testCompanies.forEnrichment2.name,
    };

    const createResponse = await apiRequest('/companies/draft', {
      method: 'POST',
      body: JSON.stringify(companyData),
    });

    expect(createResponse.ok).toBe(true);
    expect(createResponse.data.status).toBe('draft');

    const companyId = createResponse.data.id;

    // Then start enrichment
    const enrichResponse = await apiRequest(`/companies/${companyId}/enrich`, {
      method: 'POST',
      body: JSON.stringify({ model: getTestModel() }),
    });

    expect(enrichResponse.ok).toBe(true);
    expect(enrichResponse.data.success).toBe(true);
    expect(enrichResponse.data.status).toBe('enriching');
    expect(enrichResponse.data.jobId).toBeDefined();

    // Cleanup
    await apiRequest(`/companies/${companyId}`, { method: 'DELETE' });
  });

  it('should handle enrichment errors gracefully', async () => {
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
