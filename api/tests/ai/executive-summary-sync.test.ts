import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { app } from '../../src/app';
import { authenticatedRequest, createAuthenticatedUser, cleanupAuthData } from '../utils/auth-helper';
import { createTestId, getTestModel, sleep } from '../utils/test-helpers';
import { db } from '../../src/db/client';
import { folders, useCases, chatStreamEvents } from '../../src/db/schema';
import { eq } from 'drizzle-orm';

describe('Executive Summary Generation - AI', () => {
  let user: any;

  beforeEach(async () => {
    user = await createAuthenticatedUser('editor');
  });

  afterEach(async () => {
    await cleanupAuthData();
  });

  // Helper function to create a test folder with use cases
  async function createTestFolderWithUseCases() {
    const folderId = createTestId();
    
    // Create folder
    await db.insert(folders).values({
      id: folderId,
      name: `Test Folder ${createTestId()}`,
      description: 'Test folder for executive summary',
      status: 'completed',
    });

    // Create use cases with scores (scores calculés dynamiquement, pas stockés)
    const useCasesData = [
      { name: 'High Value Low Complexity', valueScores: [{ axisId: 'value1', rating: 80, description: 'High value' }], complexityScores: [{ axisId: 'complexity1', rating: 20, description: 'Low complexity' }] },
      { name: 'High Value High Complexity', valueScores: [{ axisId: 'value1', rating: 75, description: 'High value' }], complexityScores: [{ axisId: 'complexity1', rating: 70, description: 'High complexity' }] },
      { name: 'Low Value Low Complexity', valueScores: [{ axisId: 'value1', rating: 30, description: 'Low value' }], complexityScores: [{ axisId: 'complexity1', rating: 25, description: 'Low complexity' }] },
      { name: 'Low Value High Complexity', valueScores: [{ axisId: 'value1', rating: 25, description: 'Low value' }], complexityScores: [{ axisId: 'complexity1', rating: 75, description: 'High complexity' }] },
    ];

    for (const uc of useCasesData) {
      await db.insert(useCases).values({
        id: createTestId(),
        folderId,
        data: {
          name: uc.name,
          description: `Description for ${uc.name}`,
          valueScores: uc.valueScores,
          complexityScores: uc.complexityScores
        } as any,
        status: 'completed',
      });
    }

    return folderId;
  }

  describe('POST /analytics/executive-summary', () => {
    it('should generate executive summary with default medians', async () => {
      const folderId = await createTestFolderWithUseCases();

      // L'endpoint retourne maintenant jobId (asynchrone)
      const response = await authenticatedRequest(
        app,
        'POST',
        '/api/v1/analytics/executive-summary',
        user.sessionToken!,
        {
          folder_id: folderId,
          model: getTestModel(), // Use test model (gpt-4.1-nano by default)
        }
      );
      
      expect(response.status).toBe(200);
      const data = await response.json();
      
      expect(data.success).toBe(true);
      expect(data.folder_id).toBe(folderId);
      expect(data.jobId).toBeDefined();
      expect(data.status).toBe('generating');

      // Attendre la complétion du job
      const adminUser = await createAuthenticatedUser('admin_app');
      let jobCompleted = false;
      let attempts = 0;
      const maxAttempts = 30; // 5 minutes max

      while (!jobCompleted && attempts < maxAttempts) {
        await sleep(10000); // Wait 10 seconds between checks

        // Vérifier le statut du job
        const jobsRes = await authenticatedRequest(app, 'GET', '/api/v1/queue/jobs', adminUser.sessionToken!);
        expect(jobsRes.status).toBe(200);
        const jobs = await jobsRes.json();
        const job = jobs.find((j: any) => j.id === data.jobId);

        if (job && (job.status === 'completed' || job.status === 'failed')) {
          jobCompleted = true;
          expect(job.status).toBe('completed');
        }

        attempts++;
      }

      expect(jobCompleted).toBe(true);

      // Verify stored in database
      const [folder] = await db.select({ executiveSummary: folders.executiveSummary })
        .from(folders)
        .where(eq(folders.id, folderId));
      
      expect(folder?.executiveSummary).toBeDefined();
      const stored = JSON.parse(folder!.executiveSummary);
      expect(stored).toHaveProperty('introduction');
      expect(stored).toHaveProperty('analyse');
      expect(stored).toHaveProperty('recommandation');
      expect(stored).toHaveProperty('synthese_executive');

      // Vérifier que les événements sont écrits dans chat_stream_events
      const streamId = `folder_${folderId}`;
      const streamEvents = await db
        .select()
        .from(chatStreamEvents)
        .where(eq(chatStreamEvents.streamId, streamId))
        .orderBy(chatStreamEvents.sequence);
      
      expect(streamEvents.length).toBeGreaterThan(0);
      // Vérifier message_id=null pour générations classiques
      streamEvents.forEach(event => {
        expect(event.messageId).toBeNull();
      });
      // Vérifier présence d'événements content_delta et done
      const eventTypes = streamEvents.map(e => e.eventType);
      expect(eventTypes).toContain('content_delta');
      expect(eventTypes).toContain('done');
      // Événements tool_call_* possibles si web_extract/web_search utilisés
      const hasToolCalls = eventTypes.some(et => et.startsWith('tool_call_'));
      // Si web_extract est utilisé, vérifier qu'il n'y a pas d'appel avec array vide
      // (déjà testé dans tools.test.ts et chat-sync.test.ts)

      // Cleanup
      await cleanupAuthData(); // Cleanup admin user
      await db.delete(chatStreamEvents).where(eq(chatStreamEvents.streamId, streamId));
      await db.delete(useCases).where(eq(useCases.folderId, folderId));
      await db.delete(folders).where(eq(folders.id, folderId));
    }, 300000); // 5 minutes timeout for AI generation

    it('should generate executive summary with custom thresholds', async () => {
      const folderId = await createTestFolderWithUseCases();

      // L'endpoint retourne maintenant jobId (asynchrone)
      const response = await authenticatedRequest(
        app,
        'POST',
        '/api/v1/analytics/executive-summary',
        user.sessionToken!,
        {
          folder_id: folderId,
          value_threshold: 50,
          complexity_threshold: 40,
          model: getTestModel(), // Use test model (gpt-4.1-nano by default)
        }
      );
      
      expect(response.status).toBe(200);
      const data = await response.json();
      
      expect(data.success).toBe(true);
      expect(data.jobId).toBeDefined();
      expect(data.status).toBe('generating');

      // Vérifier que les seuils personnalisés sont passés au job
      const adminUser = await createAuthenticatedUser('admin_app');
      await sleep(1000); // Attendre que le job soit créé
      const jobsRes = await authenticatedRequest(app, 'GET', '/api/v1/queue/jobs', adminUser.sessionToken!);
      expect(jobsRes.status).toBe(200);
      const jobs = await jobsRes.json();
      const job = jobs.find((j: any) => j.id === data.jobId);
      
      expect(job).toBeDefined();
      expect(job.data.valueThreshold).toBe(50);
      expect(job.data.complexityThreshold).toBe(40);

      // Attendre la complétion du job
      let jobCompleted = false;
      let attempts = 0;
      const maxAttempts = 30; // 5 minutes max

      while (!jobCompleted && attempts < maxAttempts) {
        await sleep(10000); // Wait 10 seconds between checks

        const jobsRes2 = await authenticatedRequest(app, 'GET', '/api/v1/queue/jobs', adminUser.sessionToken!);
        expect(jobsRes2.status).toBe(200);
        const jobs2 = await jobsRes2.json();
        const job2 = jobs2.find((j: any) => j.id === data.jobId);

        if (job2 && (job2.status === 'completed' || job2.status === 'failed')) {
          jobCompleted = true;
          expect(job2.status).toBe('completed');
        }

        attempts++;
      }

      expect(jobCompleted).toBe(true);

      // Vérifier que les événements sont écrits dans chat_stream_events
      const streamId = `folder_${folderId}`;
      const streamEvents = await db
        .select()
        .from(chatStreamEvents)
        .where(eq(chatStreamEvents.streamId, streamId))
        .orderBy(chatStreamEvents.sequence);
      
      expect(streamEvents.length).toBeGreaterThan(0);
      streamEvents.forEach(event => {
        expect(event.messageId).toBeNull();
      });
      const eventTypes = streamEvents.map(e => e.eventType);
      expect(eventTypes).toContain('content_delta');
      expect(eventTypes).toContain('done');

      // Cleanup
      await cleanupAuthData(); // Cleanup admin user
      await db.delete(chatStreamEvents).where(eq(chatStreamEvents.streamId, streamId));
      await db.delete(useCases).where(eq(useCases.folderId, folderId));
      await db.delete(folders).where(eq(folders.id, folderId));
    }, 300000); // 5 minutes timeout for AI generation
  });
});

