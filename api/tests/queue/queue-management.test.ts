import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { apiRequest, createTestId, getTestModel, sleep } from '../utils/test-helpers';

describe('Queue Management', () => {
  let createdCompanyId: string | null = null;
  let createdFolderId: string | null = null;

  beforeAll(async () => {
    // Clear queue before starting tests
    try {
      await apiRequest('/queue/purge', {
        method: 'POST',
        body: JSON.stringify({ status: 'force' })
      });
    } catch {}
  });

  afterAll(async () => {
    // Cleanup created resources
    if (createdCompanyId) {
      try {
        await apiRequest(`/companies/${createdCompanyId}`, { method: 'DELETE' });
      } catch {}
    }
    if (createdFolderId) {
      try {
        await apiRequest(`/folders/${createdFolderId}`, { method: 'DELETE' });
      } catch {}
    }
    
    // Final cleanup - purge all remaining jobs
    try {
      await apiRequest('/queue/purge', {
        method: 'POST',
        body: JSON.stringify({ status: 'force' })
      });
    } catch {}
  });

  it('should manage job lifecycle: create, monitor, and cancel', async () => {
    // 1) Create a company draft
    const companyName = `Queue Test Company ${createTestId()}`;
    const draft = await apiRequest('/companies/draft', {
      method: 'POST',
      body: JSON.stringify({ name: companyName })
    });
    expect(draft.ok).toBe(true);
    createdCompanyId = draft.data.id as string;

    // 2) Start enrichment job
    const enrichResponse = await apiRequest(`/companies/${createdCompanyId}/enrich`, {
      method: 'POST',
      body: JSON.stringify({ model: getTestModel() })
    });
    expect(enrichResponse.ok).toBe(true);
    expect(enrichResponse.data.success).toBe(true);
    expect(enrichResponse.data.jobId).toBeDefined();

    const jobId = enrichResponse.data.jobId;

    // 3) Check initial queue status
    const initialStats = await apiRequest('/queue/stats');
    expect(initialStats.ok).toBe(true);
    expect(initialStats.data.total).toBeGreaterThan(0);
    expect(initialStats.data.pending + initialStats.data.processing).toBeGreaterThan(0);

    // 4) Check job status
    const jobStatus = await apiRequest(`/queue/jobs/${jobId}`);
    expect(jobStatus.ok).toBe(true);
    expect(jobStatus.data.id).toBe(jobId);
    expect(['pending', 'processing', 'enriching']).toContain(jobStatus.data.status);

    // 5) Test queue pause/resume
    const pauseResponse = await apiRequest('/queue/pause', {
      method: 'POST'
    });
    expect(pauseResponse.ok).toBe(true);

    // 6) Test queue resume
    const resumeResponse = await apiRequest('/queue/resume', {
      method: 'POST'
    });
    expect(resumeResponse.ok).toBe(true);

    // 7) Test queue clear (cancel all jobs)
    const clearResponse = await apiRequest('/queue/purge', {
      method: 'POST',
      body: JSON.stringify({ status: 'force' })
    });
    expect(clearResponse.ok).toBe(true);
    expect(clearResponse.data.success).toBe(true);

    // 8) Verify queue is empty
    const finalStats = await apiRequest('/queue/stats');
    expect(finalStats.ok).toBe(true);
    expect(finalStats.data.total).toBe(0);
    expect(finalStats.data.pending).toBe(0);
    expect(finalStats.data.processing).toBe(0);
  });

  it('should handle job creation and monitoring for use case generation', async () => {
    // 1) Create a company draft
    const companyName = `Queue Use Case Company ${createTestId()}`;
    const draft = await apiRequest('/companies/draft', {
      method: 'POST',
      body: JSON.stringify({ name: companyName })
    });
    expect(draft.ok).toBe(true);
    createdCompanyId = draft.data.id as string;

    // 2) Start use case generation job
    const generateResponse = await apiRequest('/use-cases/generate', {
      method: 'POST',
      body: JSON.stringify({
        input: `Generate AI use cases for ${companyName}`,
        create_new_folder: true,
        company_id: createdCompanyId,
        model: getTestModel()
      })
    });
    expect(generateResponse.ok).toBe(true);
    expect(generateResponse.data.success).toBe(true);
    expect(generateResponse.data.jobId).toBeDefined();
    createdFolderId = generateResponse.data.created_folder_id;

    // 3) Check queue status after generation start
    const stats = await apiRequest('/queue/stats');
    expect(stats.ok).toBe(true);
    expect(stats.data.total).toBeGreaterThan(0);
    expect(stats.data.byType.usecase_list).toBeGreaterThan(0);

    // 4) Wait a bit for jobs to be created
    await sleep(2000);

    // 5) Check that usecase_detail jobs are being created
    const updatedStats = await apiRequest('/queue/stats');
    expect(updatedStats.ok).toBe(true);
    expect(updatedStats.data.byType.usecase_detail).toBeGreaterThan(0);

    // 6) Test job cancellation
    const cancelResponse = await apiRequest('/queue/cancel-all', {
      method: 'POST'
    });
    expect(cancelResponse.ok).toBe(true);

    // 7) Verify jobs are cancelled
    const finalStats = await apiRequest('/queue/stats');
    expect(finalStats.ok).toBe(true);
    // Jobs should be cancelled or completed
  });
});
