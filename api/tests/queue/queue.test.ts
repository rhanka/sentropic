import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { app } from '../../src/app';
import { createTestId } from '../utils/test-helpers';
import { 
  createAuthenticatedUser, 
  authenticatedRequest, 
  cleanupAuthData 
} from '../utils/auth-helper';

describe('Queue', () => {
  let user: any;

  beforeAll(async () => {
    // Create authenticated user for queue tests
    user = await createAuthenticatedUser('admin_app');
    
    // Clear queue before starting tests
    try {
      await authenticatedRequest(app, 'POST', '/api/v1/queue/purge', user.sessionToken!, { status: 'force' });
    } catch {}
  });

  afterAll(async () => {
    // Final cleanup - purge all remaining jobs
    try {
      await authenticatedRequest(app, 'POST', '/api/v1/queue/purge', user.sessionToken!, { status: 'force' });
    } catch {}
    
    // Clean up auth data
    await cleanupAuthData();
  });

  it('should create an async enrichment job (without waiting)', async () => {
    // Create a company draft
    const companyRes = await authenticatedRequest(app, 'POST', '/api/v1/companies/draft', user.sessionToken!, {
      name: `Queue Test ${createTestId()}`
    });
    expect(companyRes.status).toBe(201);
    const companyData = await companyRes.json();
    const companyId = companyData.id;

    // Launch async enrichment job
    const enrichRes = await authenticatedRequest(app, 'POST', `/api/v1/companies/${companyId}/enrich`, user.sessionToken!, {
      model: 'gpt-4.1-nano'
    });
    expect(enrichRes.status).toBe(200);
    const enrichData = await enrichRes.json();
    expect(enrichData.success).toBe(true);
    expect(enrichData.jobId).toBeDefined();

    // Cleanup
    await authenticatedRequest(app, 'DELETE', `/api/v1/companies/${companyId}`, user.sessionToken!);
  });

  it('should expose queue statistics', async () => {
    const statsRes = await authenticatedRequest(app, 'GET', '/api/v1/queue/stats', user.sessionToken!);
    expect(statsRes.status).toBe(200);
    const stats = await statsRes.json();
    expect(stats).toHaveProperty('total');
    expect(stats).toHaveProperty('pending');
    expect(stats).toHaveProperty('processing');
    expect(stats).toHaveProperty('completed');
    expect(stats).toHaveProperty('failed');
    expect(stats).toHaveProperty('byType');
  });

  it('should list queue jobs', async () => {
    const jobsRes = await authenticatedRequest(app, 'GET', '/api/v1/queue/jobs', user.sessionToken!);
    expect(jobsRes.status).toBe(200);
    const jobs = await jobsRes.json();
    expect(Array.isArray(jobs)).toBe(true);
  });

  it('should purge queue successfully', async () => {
    const purgeRes = await authenticatedRequest(app, 'POST', '/api/v1/queue/purge', user.sessionToken!, {
      status: 'force'
    });
    expect(purgeRes.status).toBe(200);
    const purge = await purgeRes.json();
    expect(purge.success).toBe(true);
  });
});


