import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { apiRequest, createTestId } from '../utils/test-helpers';

describe('Queue', () => {
  beforeAll(async () => {
    // Clear queue before starting tests
    try {
      await apiRequest('/api/v1/queue/purge', {
        method: 'POST',
        body: JSON.stringify({ status: 'force' })
      });
    } catch {}
  });

  afterAll(async () => {
    // Final cleanup - purge all remaining jobs
    try {
      await apiRequest('/api/v1/queue/purge', {
        method: 'POST',
        body: JSON.stringify({ status: 'force' })
      });
    } catch {}
  });

  it('should create an async enrichment job (without waiting)', async () => {
    // Create a company draft
    const companyResponse = await apiRequest('/api/v1/companies/draft', {
      method: 'POST',
      body: JSON.stringify({ name: `Queue Test ${createTestId()}` })
    });
    expect(companyResponse.ok).toBe(true);
    const companyId = companyResponse.data.id as string;

    // Launch async enrichment job
    const enrichResponse = await apiRequest(`/api/v1/companies/${companyId}/enrich`, {
      method: 'POST',
      body: JSON.stringify({ model: 'gpt-4.1-nano' })
    });
    expect(enrichResponse.ok).toBe(true);
    expect(enrichResponse.data.success).toBe(true);
    expect(enrichResponse.data.jobId).toBeDefined();

    // Cleanup
    await apiRequest(`/api/v1/companies/${companyId}`, { method: 'DELETE' });
  });

  it('should expose queue statistics', async () => {
    const stats = await apiRequest('/api/v1/queue/stats');
    expect(stats.ok).toBe(true);
    expect(stats.data).toHaveProperty('total');
    expect(stats.data).toHaveProperty('pending');
    expect(stats.data).toHaveProperty('processing');
    expect(stats.data).toHaveProperty('completed');
    expect(stats.data).toHaveProperty('failed');
    expect(stats.data).toHaveProperty('byType');
  });

  it('should list queue jobs', async () => {
    const jobs = await apiRequest('/api/v1/queue/jobs');
    expect(jobs.ok).toBe(true);
    expect(Array.isArray(jobs.data)).toBe(true);
  });

  it('should purge queue successfully', async () => {
    const purge = await apiRequest('/api/v1/queue/purge', {
      method: 'POST',
      body: JSON.stringify({ status: 'force' })
    });
    expect(purge.ok).toBe(true);
    expect(purge.data.success).toBe(true);
  });
});


