import { describe, it, expect, afterEach } from 'vitest';
import { apiRequest, createTestId, sleep } from '../utils/test-helpers';
import { testCompanies } from '../utils/test-data';

describe('Company Enrichment AI', () => {
  let createdCompanyId: string | null = null;

  afterEach(async () => {
    // Cleanup
    if (createdCompanyId) {
      await apiRequest(`/companies/${createdCompanyId}`, { method: 'DELETE' });
      createdCompanyId = null;
    }
  });

  it('should create a company draft and enrich it with AI', async () => {
    const companyName = `Test Company Enrichment ${createTestId()}`;

    // 1. Create a company draft
    const draftResponse = await apiRequest('/companies/draft', {
      method: 'POST',
      body: JSON.stringify({ name: companyName }),
    });

    expect(draftResponse.ok).toBe(true);
    expect(draftResponse.data.name).toBe(companyName);
    expect(draftResponse.data.status).toBe('draft');
    expect(draftResponse.data.industry).toBeNull();
    
    createdCompanyId = draftResponse.data.id;

    // 2. Start AI enrichment
    const enrichResponse = await apiRequest(`/companies/${createdCompanyId}/enrich`, {
      method: 'POST',
      body: JSON.stringify({ model: 'gpt-4o' }),
    });

    expect(enrichResponse.ok).toBe(true);
    expect(enrichResponse.data.success).toBe(true);
    expect(enrichResponse.data.status).toBe('enriching');
    expect(enrichResponse.data.jobId).toBeDefined();

    // 3. Wait for enrichment to complete
    await sleep(30000);

    // 4. Verify the company was enriched
    const enrichedResponse = await apiRequest(`/companies/${createdCompanyId}`);
    expect(enrichedResponse.ok).toBe(true);
    
    const enrichedCompany = enrichedResponse.data;
    expect(enrichedCompany.status).toBe('completed');
    expect(enrichedCompany.industry).toBeDefined();
    expect(enrichedCompany.industry).not.toBeNull();
    expect(enrichedCompany.size).toBeDefined();
    expect(enrichedCompany.products).toBeDefined();
    expect(enrichedCompany.processes).toBeDefined();
    expect(enrichedCompany.challenges).toBeDefined();
    expect(enrichedCompany.objectives).toBeDefined();
    expect(enrichedCompany.technologies).toBeDefined();
  }, 40000);

  it('should handle enrichment errors gracefully', async () => {
    const companyName = `Test Company Error ${createTestId()}`;

    // Create a company draft
    const draftResponse = await apiRequest('/companies/draft', {
      method: 'POST',
      body: JSON.stringify({ name: companyName }),
    });

    expect(draftResponse.ok).toBe(true);
    createdCompanyId = draftResponse.data.id;

    // Try to enrich with invalid model (should still work but might fail)
    const enrichResponse = await apiRequest(`/companies/${createdCompanyId}/enrich`, {
      method: 'POST',
      body: JSON.stringify({ model: 'invalid-model' }),
    });

    expect(enrichResponse.ok).toBe(true);
    expect(enrichResponse.data.success).toBe(true);
    expect(enrichResponse.data.jobId).toBeDefined();

    // Wait a bit and check if it failed gracefully
    await sleep(10000);
    
    const statusResponse = await apiRequest(`/companies/${createdCompanyId}`);
    expect(statusResponse.ok).toBe(true);
    
    // The company should still exist, even if enrichment failed
    expect(statusResponse.data.id).toBe(createdCompanyId);
  }, 20000);

  it('should allow multiple enrichment attempts', async () => {
    const companyName = `Test Company Multiple ${createTestId()}`;

    // Create a company draft
    const draftResponse = await apiRequest('/companies/draft', {
      method: 'POST',
      body: JSON.stringify({ name: companyName }),
    });

    expect(draftResponse.ok).toBe(true);
    createdCompanyId = draftResponse.data.id;

    // First enrichment attempt
    const enrichResponse1 = await apiRequest(`/companies/${createdCompanyId}/enrich`, {
      method: 'POST',
      body: JSON.stringify({ model: 'gpt-4o' }),
    });

    expect(enrichResponse1.ok).toBe(true);
    expect(enrichResponse1.data.success).toBe(true);

    // Wait for first enrichment
    await sleep(30000);

    // Second enrichment attempt (should work)
    const enrichResponse2 = await apiRequest(`/companies/${createdCompanyId}/enrich`, {
      method: 'POST',
      body: JSON.stringify({ model: 'gpt-4o' }),
    });

    expect(enrichResponse2.ok).toBe(true);
    expect(enrichResponse2.data.success).toBe(true);
    expect(enrichResponse2.data.jobId).toBeDefined();

    // Wait for second enrichment
    await sleep(30000);

    // Verify the company is still enriched
    const finalResponse = await apiRequest(`/companies/${createdCompanyId}`);
    expect(finalResponse.ok).toBe(true);
    expect(finalResponse.data.status).toBe('completed');
  }, 70000);
});
