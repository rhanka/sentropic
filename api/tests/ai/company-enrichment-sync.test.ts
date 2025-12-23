import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getTestModel } from '../utils/test-helpers';
import { authenticatedRequest, createAuthenticatedUser, cleanupAuthData } from '../utils/auth-helper';
import { app } from '../../src/app';
import { testCompanies } from '../utils/test-data';
import { db } from '../../src/db/client';
import { companies, chatStreamEvents } from '../../src/db/schema';
import { eq } from 'drizzle-orm';
import { createTestId, sleep } from '../utils/test-helpers';

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

  it('should enrich a company asynchronously and verify stream events', async () => {
    // Créer une entreprise draft
    const companyName = `Test Company Stream ${createTestId()}`;
    const createResponse = await authenticatedRequest(
      app,
      'POST',
      '/api/v1/companies/draft',
      user.sessionToken!,
      { name: companyName }
    );
    expect(createResponse.status).toBe(201);
    const companyData = await createResponse.json();
    const companyId = companyData.id;

    // Démarrer l'enrichissement asynchrone
    const enrichResponse = await authenticatedRequest(
      app,
      'POST',
      `/api/v1/companies/${companyId}/enrich`,
      user.sessionToken!,
      { model: getTestModel() }
    );

    expect(enrichResponse.status).toBe(200);
    const enrichResult = await enrichResponse.json();
    expect(enrichResult.success).toBe(true);
    expect(enrichResult.jobId).toBeDefined();

    // Attendre la complétion du job
    let jobCompleted = false;
    let attempts = 0;
    const maxAttempts = 18; // 18 * 1s = 18s max (reste < timeout test: 20s)

    while (!jobCompleted && attempts < maxAttempts) {
      await sleep(1000);

      // Queue is workspace-scoped: read the job directly with the owner's token.
      const jobRes = await authenticatedRequest(app, 'GET', `/api/v1/queue/jobs/${enrichResult.jobId}`, user.sessionToken!);
      expect(jobRes.status).toBe(200);
      const job = await jobRes.json();

      if (job && (job.status === 'completed' || job.status === 'failed')) {
        jobCompleted = true;
        expect(job.status).toBe('completed');
      }
      attempts++;
    }

    expect(jobCompleted).toBe(true);

    // Vérifier que les événements sont écrits dans chat_stream_events
    const streamId = `company_${companyId}`;
    const streamEvents = await db
      .select()
      .from(chatStreamEvents)
      .where(eq(chatStreamEvents.streamId, streamId))
      .orderBy(chatStreamEvents.sequence);

    expect(streamEvents.length).toBeGreaterThan(0);
    streamEvents.forEach(event => {
      expect(event.messageId).toBeNull(); // Générations classiques
    });
    const eventTypes = streamEvents.map(e => e.eventType);
    expect(eventTypes).toContain('content_delta');
    expect(eventTypes).toContain('done');

    // Cleanup
    await db.delete(chatStreamEvents).where(eq(chatStreamEvents.streamId, streamId));
    await db.delete(companies).where(eq(companies.id, companyId));
  }, 20000); // 20 seconds timeout
});
