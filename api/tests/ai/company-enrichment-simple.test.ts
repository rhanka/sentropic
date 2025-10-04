import { describe, it, expect, afterEach } from 'vitest';
import { apiRequest, createTestId, getTestModel } from '../utils/test-helpers';

describe('Company Enrichment AI - Simple', () => {
  let createdCompanyId: string | null = null;

  afterEach(async () => {
    // Cleanup
    if (createdCompanyId) {
      await apiRequest(`/companies/${createdCompanyId}`, { method: 'DELETE' });
      createdCompanyId = null;
    }
  });

  it('should create a company draft', async () => {
    const companyName = `Test Company Draft ${createTestId()}`;

    const draftResponse = await apiRequest('/companies/draft', {
      method: 'POST',
      body: JSON.stringify({ name: companyName }),
    });

    expect(draftResponse.ok).toBe(true);
    expect(draftResponse.data.name).toBe(companyName);
    expect(draftResponse.data.status).toBe('draft');
    expect(draftResponse.data.industry).toBeNull();
    
    createdCompanyId = draftResponse.data.id;
  });

  it('should start AI enrichment process', async () => {
    const companyName = `Test Company Enrich ${createTestId()}`;

    // Create a company draft
    const draftResponse = await apiRequest('/companies/draft', {
      method: 'POST',
      body: JSON.stringify({ name: companyName }),
    });

    expect(draftResponse.ok).toBe(true);
    createdCompanyId = draftResponse.data.id;

    // Start AI enrichment
    const enrichResponse = await apiRequest(`/companies/${createdCompanyId}/enrich`, {
      method: 'POST',
      body: JSON.stringify({ model: getTestModel() }),
    });

    expect(enrichResponse.ok).toBe(true);
    expect(enrichResponse.data.success).toBe(true);
    expect(enrichResponse.data.status).toBe('enriching');
    expect(enrichResponse.data.jobId).toBeDefined();

    // Verify the company status was updated
    const companyResponse = await apiRequest(`/companies/${createdCompanyId}`);
    expect(companyResponse.ok).toBe(true);
    expect(companyResponse.data.status).toBe('enriching');
  });

  it('should handle enrichment with different models', async () => {
    const companyName = `Test Company Model ${createTestId()}`;

    // Create a company draft
    const draftResponse = await apiRequest('/companies/draft', {
      method: 'POST',
      body: JSON.stringify({ name: companyName }),
    });

    expect(draftResponse.ok).toBe(true);
    createdCompanyId = draftResponse.data.id;

    // Test with different models
    const models = [getTestModel(), 'gpt-4o', 'gpt-4o-mini'];
    
    for (const model of models) {
      const enrichResponse = await apiRequest(`/companies/${createdCompanyId}/enrich`, {
        method: 'POST',
        body: JSON.stringify({ model }),
      });

      expect(enrichResponse.ok).toBe(true);
      expect(enrichResponse.data.success).toBe(true);
      expect(enrichResponse.data.jobId).toBeDefined();
    }
  });

  it('should handle invalid company ID', async () => {
    const invalidId = 'invalid-company-id';

    const enrichResponse = await apiRequest(`/companies/${invalidId}/enrich`, {
      method: 'POST',
      body: JSON.stringify({ model: getTestModel() }),
    });

    expect(enrichResponse.ok).toBe(false);
    expect(enrichResponse.status).toBe(404);
  });

  it('should handle missing model parameter', async () => {
    const companyName = `Test Company No Model ${createTestId()}`;

    // Create a company draft
    const draftResponse = await apiRequest('/companies/draft', {
      method: 'POST',
      body: JSON.stringify({ name: companyName }),
    });

    expect(draftResponse.ok).toBe(true);
    createdCompanyId = draftResponse.data.id;

    // Start enrichment without model (should use default)
    const enrichResponse = await apiRequest(`/companies/${createdCompanyId}/enrich`, {
      method: 'POST',
      body: JSON.stringify({}),
    });

    expect(enrichResponse.ok).toBe(true);
    expect(enrichResponse.data.success).toBe(true);
    expect(enrichResponse.data.jobId).toBeDefined();
  });
});
