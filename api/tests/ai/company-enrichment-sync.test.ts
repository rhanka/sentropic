import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getTestModel } from '../utils/test-helpers';
import { authenticatedRequest, createAuthenticatedUser, cleanupAuthData } from '../utils/auth-helper';
import { app } from '../../src/app';
import { testCompanies } from '../utils/test-data';

describe('Company Enrichment - Sync', () => {
  let user: any;

  beforeEach(async () => {
    user = await createAuthenticatedUser('editor');
  });

  afterEach(async () => {
    await cleanupAuthData();
  });

  it('should enrich a company directly via /companies/ai-enrich', async () => {
    const enrichData = {
      name: testCompanies.forEnrichment.name,
      model: getTestModel(),
    };

    const response = await authenticatedRequest(
      app,
      'POST',
      '/api/v1/companies/ai-enrich',
      user.sessionToken!,
      enrichData
    );

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.industry).toBeDefined();
    expect(data.products).toBeDefined();
    expect(data.processes).toBeDefined();
    expect(data.challenges).toBeDefined();
    expect(data.objectives).toBeDefined();
    expect(data.technologies).toBeDefined();
  });

  it('should handle enrichment errors gracefully', async () => {
    const enrichData = {
      name: '', // Invalid name
      model: getTestModel(),
    };

    const response = await authenticatedRequest(
      app,
      'POST',
      '/api/v1/companies/ai-enrich',
      user.sessionToken!,
      enrichData
    );

    expect(response.status).toBe(400);
  });

  it('should work with single model (minimal OpenAI calls)', async () => {
    const enrichData = {
      name: `Test Company Single Model`,
      model: getTestModel(),
    };

    const response = await authenticatedRequest(
      app,
      'POST',
      '/api/v1/companies/ai-enrich',
      user.sessionToken!,
      enrichData
    );

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.industry).toBeDefined();
  });
});
