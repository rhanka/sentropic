import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getTestModel } from '../utils/test-helpers';
import { authenticatedRequest, createAuthenticatedUser, cleanupAuthData } from '../utils/auth-helper';
import { app } from '../../src/app';
import { testOrganizations } from '../utils/test-data';
import { db } from '../../src/db/client';
import { organizations, chatStreamEvents } from '../../src/db/schema';
import { eq } from 'drizzle-orm';
import { createTestId, sleep } from '../utils/test-helpers';

describe('Organization Enrichment - Sync', () => {
  let user: any;

  beforeEach(async () => {
    user = await createAuthenticatedUser('editor');
  });

  afterEach(async () => {
    await cleanupAuthData();
  });

  it('should enrich an organization directly via /organizations/ai-enrich', async () => {
    const enrichData = {
      name: testOrganizations.forEnrichment.name,
      model: getTestModel(),
    };

    const response = await authenticatedRequest(
      app,
      'POST',
      '/api/v1/organizations/ai-enrich',
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
      '/api/v1/organizations/ai-enrich',
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
      '/api/v1/organizations/ai-enrich',
      user.sessionToken!,
      enrichData
    );

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.industry).toBeDefined();
  });

  it('should enrich an organization asynchronously and verify stream events', async () => {
    // Créer une organisation draft
    const organizationName = `Test Organization Stream ${createTestId()}`;
    const createResponse = await authenticatedRequest(
      app,
      'POST',
      '/api/v1/organizations/draft',
      user.sessionToken!,
      { name: organizationName }
    );
    expect(createResponse.status).toBe(201);
    const organizationData = await createResponse.json();
    const organizationId = organizationData.id;

    // Démarrer l'enrichissement asynchrone
    const enrichResponse = await authenticatedRequest(
      app,
      'POST',
      `/api/v1/organizations/${organizationId}/enrich`,
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
    const maxAttempts = 60; // 60 * 1s = 60s max (AI + web search peut être lent / flaky)

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
    const streamId = `organization_${organizationId}`;
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
    await db.delete(organizations).where(eq(organizations.id, organizationId));
  }, 90000); // 90 seconds timeout (flakiness mitigation)
});
