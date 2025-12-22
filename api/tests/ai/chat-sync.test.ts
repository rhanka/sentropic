import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { app } from '../../src/app';
import { createTestId, getTestModel, sleep } from '../utils/test-helpers';
import { 
  createAuthenticatedUser, 
  authenticatedRequest, 
  cleanupAuthData 
} from '../utils/auth-helper';
import { db } from '../../src/db/client';
import { chatMessages } from '../../src/db/schema';
import { eq } from 'drizzle-orm';

describe('Chat AI - Complete Integration', () => {
  let user: any;

  beforeEach(async () => {
    await cleanupAuthData();
    user = await createAuthenticatedUser('editor');
  });

  afterEach(async () => {
    await cleanupAuthData();
  });

  describe('POST /api/v1/chat/messages - AI Generation', () => {
    it('should generate assistant response with AI', async () => {
      // Envoyer un message simple pour test rapide
      const response = await authenticatedRequest(app, 'POST', '/api/v1/chat/messages', user.sessionToken!, {
        content: 'Say hello in one sentence',
        model: getTestModel()
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      const { jobId, assistantMessageId } = data;
      expect(jobId).toBeDefined();
      expect(assistantMessageId).toBeDefined();

      // Attendre la complétion du job (max 10s: 10 tentatives * 1s)
      let jobCompleted = false;
      let attempts = 0;
      const maxAttempts = 10;

      while (!jobCompleted && attempts < maxAttempts) {
        await sleep(1000); // Wait 1 second between checks

        // Queue is workspace-scoped: read the job directly with the owner's token.
        const jobRes = await authenticatedRequest(app, 'GET', `/api/v1/queue/jobs/${jobId}`, user.sessionToken!);
        expect(jobRes.status).toBe(200);
        const job = await jobRes.json();

        if (job && (job.status === 'completed' || job.status === 'failed')) {
          jobCompleted = true;
          expect(job.status).toBe('completed');
        }

        attempts++;
      }

      expect(jobCompleted).toBe(true);

      // Vérifier que le message assistant a été mis à jour avec du contenu
      const [assistantMsg] = await db
        .select()
        .from(chatMessages)
        .where(eq(chatMessages.id, assistantMessageId));

      expect(assistantMsg).toBeDefined();
      expect(assistantMsg.role).toBe('assistant');
      expect(assistantMsg.content).toBeTruthy();
      expect(String(assistantMsg.content).length).toBeGreaterThan(0);
    }, 15000); // 15 seconds timeout for AI generation

    it('should generate response with tool calls', async () => {
      // Créer un folder et use case pour le contexte
      const folderResponse = await authenticatedRequest(app, 'POST', '/api/v1/folders', user.sessionToken!, {
        name: `Test Folder ${createTestId()}`,
        description: 'Test folder'
      });
      expect(folderResponse.status).toBe(201);
      const { id: folderId } = await folderResponse.json();

      // Créer un use case
      const useCaseResponse = await authenticatedRequest(app, 'POST', '/api/v1/use-cases', user.sessionToken!, {
        name: `Test UC ${createTestId()}`,
        description: 'Test',
        folderId
      });
      expect(useCaseResponse.status).toBe(201);
      const { id: useCaseId } = await useCaseResponse.json();

      // Message simple qui devrait déclencher read_usecase
      const chatResponse = await authenticatedRequest(app, 'POST', '/api/v1/chat/messages', user.sessionToken!, {
        content: `Read use case ${useCaseId}`,
        primaryContextType: 'usecase',
        primaryContextId: useCaseId,
        model: getTestModel()
      });

      expect(chatResponse.status).toBe(200);
      const chatData = await chatResponse.json();
      const { jobId, assistantMessageId } = chatData;

      // Attendre la complétion du job
      let jobCompleted = false;
      let attempts = 0;
      const maxAttempts = 30;

      while (!jobCompleted && attempts < maxAttempts) {
        await sleep(10000);

        const jobRes = await authenticatedRequest(app, 'GET', `/api/v1/queue/jobs/${jobId}`, user.sessionToken!);
        expect(jobRes.status).toBe(200);
        const job = await jobRes.json();

        if (job && (job.status === 'completed' || job.status === 'failed')) {
          jobCompleted = true;
          expect(job.status).toBe('completed');
        }

        attempts++;
      }

      expect(jobCompleted).toBe(true);

      // Vérifier les stream events pour voir si des tool calls ont été effectués
      const streamEventsRes = await authenticatedRequest(
        app,
        'GET',
        `/api/v1/chat/messages/${assistantMessageId}/stream-events`,
        user.sessionToken!
      );

      expect(streamEventsRes.status).toBe(200);
      const streamEvents = await streamEventsRes.json();
      
      // Il devrait y avoir des events (tool calls ou content)
      expect(streamEvents.events).toBeDefined();
      expect(Array.isArray(streamEvents.events)).toBe(true);
    }, 15000);

    it('should handle web_extract tool calls correctly (no empty URLs)', async () => {
      // Message simple - l'IA ne devrait pas appeler web_extract avec un array vide
      const chatResponse = await authenticatedRequest(app, 'POST', '/api/v1/chat/messages', user.sessionToken!, {
        content: 'What is AI?',
        model: getTestModel()
      });

      expect(chatResponse.status).toBe(200);
      const chatData = await chatResponse.json();
      const { jobId, assistantMessageId } = chatData;

      // Attendre la complétion du job
      let jobCompleted = false;
      let attempts = 0;
      const maxAttempts = 30;

      while (!jobCompleted && attempts < maxAttempts) {
        await sleep(10000);

        const jobRes = await authenticatedRequest(app, 'GET', `/api/v1/queue/jobs/${jobId}`, user.sessionToken!);
        expect(jobRes.status).toBe(200);
        const job = await jobRes.json();

        if (job && (job.status === 'completed' || job.status === 'failed')) {
          jobCompleted = true;
          // Le job devrait être completed, pas failed (pas d'erreur web_extract avec array vide)
          expect(job.status).toBe('completed');
        }

        attempts++;
      }

      expect(jobCompleted).toBe(true);

      // Vérifier que le message assistant a du contenu
      const [assistantMsg] = await db
        .select()
        .from(chatMessages)
        .where(eq(chatMessages.id, assistantMessageId));

      expect(assistantMsg).toBeDefined();
      expect(assistantMsg.content).toBeTruthy();
      expect(String(assistantMsg.content).length).toBeGreaterThan(0);

      // Cleanup admin user
      await cleanupAuthData();
    }, 300000);

    it('should maintain conversation context across multiple messages', async () => {
      // Premier message simple
      const firstResponse = await authenticatedRequest(app, 'POST', '/api/v1/chat/messages', user.sessionToken!, {
        content: 'My name is Bob',
        model: getTestModel()
      });
      const firstData = await firstResponse.json();
      const { sessionId, jobId: firstJobId } = firstData;

      // Attendre la complétion du premier job (max 10s)
      let firstJobCompleted = false;
      let attempts = 0;
      const maxAttempts = 10;

      while (!firstJobCompleted && attempts < maxAttempts) {
        await sleep(1000);
        const jobRes = await authenticatedRequest(app, 'GET', `/api/v1/queue/jobs/${firstJobId}`, user.sessionToken!);
        expect(jobRes.status).toBe(200);
        const job = await jobRes.json();
        if (job && (job.status === 'completed' || job.status === 'failed')) {
          firstJobCompleted = true;
          expect(job.status).toBe('completed');
        }
        attempts++;
      }

      expect(firstJobCompleted).toBe(true);

      // Deuxième message dans la même session
      const secondResponse = await authenticatedRequest(app, 'POST', '/api/v1/chat/messages', user.sessionToken!, {
        sessionId,
        content: 'What is my name?',
        model: getTestModel()
      });
      const secondData = await secondResponse.json();
      const { jobId: secondJobId, assistantMessageId } = secondData;

      // Attendre la complétion du deuxième job (max 10s)
      let secondJobCompleted = false;
      attempts = 0;

      while (!secondJobCompleted && attempts < maxAttempts) {
        await sleep(1000);
        const jobRes = await authenticatedRequest(app, 'GET', `/api/v1/queue/jobs/${secondJobId}`, user.sessionToken!);
        expect(jobRes.status).toBe(200);
        const job = await jobRes.json();
        if (job && (job.status === 'completed' || job.status === 'failed')) {
          secondJobCompleted = true;
          expect(job.status).toBe('completed');
        }
        attempts++;
      }

      expect(secondJobCompleted).toBe(true);

      // Vérifier que la réponse mentionne "Bob"
      const [assistantMsg] = await db
        .select()
        .from(chatMessages)
        .where(eq(chatMessages.id, assistantMessageId));

      expect(assistantMsg).toBeDefined();
      expect(assistantMsg.content).toBeTruthy();
      expect(String(assistantMsg.content).toLowerCase()).toMatch(/bob/i);

      // Cleanup admin user
      await cleanupAuthData();
    }, 30000); // 30 seconds timeout (2 générations)
  });
});

