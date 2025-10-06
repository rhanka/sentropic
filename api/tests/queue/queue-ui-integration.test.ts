import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { apiRequest, createTestId, sleep } from '../utils/test-helpers';

describe('Queue UI Integration', () => {
  let testCompanyId: string;
  let testJobId: string;

  beforeAll(async () => {
    // Créer une entreprise de test
    const companyResponse = await apiRequest('/companies/draft', {
      method: 'POST',
      body: JSON.stringify({ name: `Test Company UI ${createTestId()}` })
    });
    
    expect(companyResponse.ok).toBe(true);
    testCompanyId = companyResponse.data.id;
  });

  afterAll(async () => {
    // Nettoyer l'entreprise de test
    if (testCompanyId) {
      await apiRequest(`/companies/${testCompanyId}`, {
        method: 'DELETE'
      });
    }
  });

  it('should create and track a company enrichment job', async () => {
    // Démarrer l'enrichissement
    const enrichResponse = await apiRequest(`/companies/${testCompanyId}/enrich`, {
      method: 'POST',
      body: JSON.stringify({ model: 'gpt-5' })
    });

    expect(enrichResponse.ok).toBe(true);
    expect(enrichResponse.data.success).toBe(true);
    expect(enrichResponse.data.status).toBe('enriching');
    expect(enrichResponse.data.jobId).toBeDefined();
    
    testJobId = enrichResponse.data.jobId;

    // Vérifier que le job est dans la queue
    const jobsResponse = await apiRequest('/queue/jobs');
    expect(jobsResponse.ok).toBe(true);
    
    const job = jobsResponse.data.find((j: any) => j.id === testJobId);
    expect(job).toBeDefined();
    expect(job.type).toBe('company_enrich');
    expect(job.data.companyId).toBe(testCompanyId);
  }, 10000);

  it('should provide job status endpoint', async () => {
    expect(testJobId).toBeDefined();
    
    const statusResponse = await apiRequest(`/queue/jobs/${testJobId}`);
    expect(statusResponse.ok).toBe(true);
    expect(statusResponse.data.id).toBe(testJobId);
    expect(statusResponse.data.type).toBe('company_enrich');
  });

  it('should provide queue statistics', async () => {
    const statsResponse = await apiRequest('/queue/stats');
    expect(statsResponse.ok).toBe(true);
    
    const stats = statsResponse.data;
    expect(stats).toHaveProperty('total');
    expect(stats).toHaveProperty('pending');
    expect(stats).toHaveProperty('processing');
    expect(stats).toHaveProperty('completed');
    expect(stats).toHaveProperty('failed');
    expect(stats).toHaveProperty('byType');
    expect(stats.byType).toHaveProperty('company_enrich');
    expect(stats.byType).toHaveProperty('usecase_list');
    expect(stats.byType).toHaveProperty('usecase_detail');
  });

  it('should handle job retry for failed jobs', async () => {
    // Trouver un job échoué
    const jobsResponse = await apiRequest('/queue/jobs');
    expect(jobsResponse.ok).toBe(true);
    
    const failedJob = jobsResponse.data.find((j: any) => j.status === 'failed');
    if (failedJob) {
      const retryResponse = await apiRequest(`/queue/jobs/${failedJob.id}/retry`, {
        method: 'POST'
      });
      
      expect(retryResponse.ok).toBe(true);
      expect(retryResponse.data.success).toBe(true);
      expect(retryResponse.data.newJobId).toBeDefined();
    }
  });

  it('should handle job cancellation request', async () => {
    // Trouver un job en cours
    const jobsResponse = await apiRequest('/queue/jobs');
    expect(jobsResponse.ok).toBe(true);
    
    const processingJob = jobsResponse.data.find((j: any) => j.status === 'processing');
    if (processingJob) {
      const cancelResponse = await apiRequest(`/queue/jobs/${processingJob.id}/cancel`, {
        method: 'POST'
      });
      
      expect(cancelResponse.ok).toBe(true);
      expect(cancelResponse.data.success).toBe(true);
    }
  });

  it('should complete the enrichment job', async () => {
    expect(testJobId).toBeDefined();
    
    // Attendre que le job se termine
    await sleep(15000);
    
    const statusResponse = await apiRequest(`/queue/jobs/${testJobId}`);
    expect(statusResponse.ok).toBe(true);
    
    // Le job devrait être terminé (completed ou failed)
    expect(['completed', 'failed']).toContain(statusResponse.data.status);
  }, 20000);
});
