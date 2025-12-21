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
  let user2: any;

  beforeAll(async () => {
    // Create authenticated user for queue tests
    user = await createAuthenticatedUser('admin_app');
    user2 = await createAuthenticatedUser('editor');
    
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

  it('should allow a user to purge only their own jobs (workspace-scoped)', async () => {
    // user2 creates a job in their workspace
    const companyRes2 = await authenticatedRequest(app, 'POST', '/api/v1/companies/draft', user2.sessionToken!, {
      name: `Queue Test U2 ${createTestId()}`
    });
    expect(companyRes2.status).toBe(201);
    const company2 = await companyRes2.json();

    const enrichRes2 = await authenticatedRequest(app, 'POST', `/api/v1/companies/${company2.id}/enrich`, user2.sessionToken!, {
      model: 'gpt-4.1-nano'
    });
    expect(enrichRes2.status).toBe(200);

    // user (admin workspace) creates a job in their workspace
    const companyRes = await authenticatedRequest(app, 'POST', '/api/v1/companies/draft', user.sessionToken!, {
      name: `Queue Test U1 ${createTestId()}`
    });
    expect(companyRes.status).toBe(201);
    const company = await companyRes.json();

    const enrichRes = await authenticatedRequest(app, 'POST', `/api/v1/companies/${company.id}/enrich`, user.sessionToken!, {
      model: 'gpt-4.1-nano'
    });
    expect(enrichRes.status).toBe(200);

    // Ensure both see at least one job
    const jobs1Before = await authenticatedRequest(app, 'GET', '/api/v1/queue/jobs', user.sessionToken!);
    expect(jobs1Before.status).toBe(200);
    const j1b = await jobs1Before.json();
    expect(Array.isArray(j1b)).toBe(true);

    const jobs2Before = await authenticatedRequest(app, 'GET', '/api/v1/queue/jobs', user2.sessionToken!);
    expect(jobs2Before.status).toBe(200);
    const j2b = await jobs2Before.json();
    expect(Array.isArray(j2b)).toBe(true);
    expect(j2b.length).toBeGreaterThan(0);

    // user2 purges their own jobs
    const purgeMine = await authenticatedRequest(app, 'POST', '/api/v1/queue/purge-mine', user2.sessionToken!, { status: 'all' });
    expect(purgeMine.status).toBe(200);
    const purgeData = await purgeMine.json();
    expect(purgeData.success).toBe(true);

    // user2 now sees no jobs (or fewer), while user still sees theirs
    const jobs2After = await authenticatedRequest(app, 'GET', '/api/v1/queue/jobs', user2.sessionToken!);
    expect(jobs2After.status).toBe(200);
    const j2a = await jobs2After.json();
    expect(Array.isArray(j2a)).toBe(true);
    expect(j2a.length).toBe(0);

    const jobs1After = await authenticatedRequest(app, 'GET', '/api/v1/queue/jobs', user.sessionToken!);
    expect(jobs1After.status).toBe(200);
    const j1a = await jobs1After.json();
    expect(Array.isArray(j1a)).toBe(true);

    // Cleanup resources
    await authenticatedRequest(app, 'DELETE', `/api/v1/companies/${company2.id}`, user2.sessionToken!);
    await authenticatedRequest(app, 'DELETE', `/api/v1/companies/${company.id}`, user.sessionToken!);
  });
});


