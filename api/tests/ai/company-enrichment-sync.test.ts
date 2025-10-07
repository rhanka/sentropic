import { describe, it, expect } from 'vitest';
import { apiRequest, getTestModel } from '../utils/test-helpers';
import { testCompanies } from '../utils/test-data';

describe('Company Enrichment - Sync', () => {
  it('should enrich a company directly via /companies/ai-enrich', async () => {
    const enrichData = {
      name: testCompanies.forEnrichment.name,
      model: getTestModel(),
    };

    const response = await apiRequest('/api/v1/companies/ai-enrich', {
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

  it('should handle enrichment errors gracefully', async () => {
    const enrichData = {
      name: '', // Invalid name
      model: getTestModel(),
    };

    const response = await apiRequest('/api/v1/companies/ai-enrich', {
      method: 'POST',
      body: JSON.stringify(enrichData),
    });

    expect(response.ok).toBe(false);
    expect(response.status).toBe(400);
  });

  it('should work with single model (minimal OpenAI calls)', async () => {
    const enrichData = {
      name: `Test Company Single Model`,
      model: getTestModel(),
    };

    const response = await apiRequest('/api/v1/companies/ai-enrich', {
      method: 'POST',
      body: JSON.stringify(enrichData),
    });

    expect(response.ok).toBe(true);
    expect(response.data.industry).toBeDefined();
  });
});
