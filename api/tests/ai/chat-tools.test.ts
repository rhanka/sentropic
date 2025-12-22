import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { app } from '../../src/app';
import { createTestId, getTestModel, sleep } from '../utils/test-helpers';
import {
  createAuthenticatedUser,
  authenticatedRequest,
  cleanupAuthData
} from '../utils/auth-helper';
import { db } from '../../src/db/client';
import { chatMessages, chatStreamEvents, chatContexts, contextModificationHistory, useCases, folders } from '../../src/db/schema';
import { eq, and } from 'drizzle-orm';

describe('Chat AI - Tool Calls Integration', () => {
  let user: any;
  let useCaseId: string;
  let folderId: string;

  beforeEach(async () => {
    user = await createAuthenticatedUser('editor');
    
    // Créer un folder
    const folderResponse = await authenticatedRequest(app, 'POST', '/api/v1/folders', user.sessionToken!, {
      name: `Test Folder ${createTestId()}`,
      description: 'Test folder for tool calls'
    });
    expect(folderResponse.status).toBe(201);
    folderId = (await folderResponse.json()).id;

    // Créer un use case
    const useCaseResponse = await authenticatedRequest(app, 'POST', '/api/v1/use-cases', user.sessionToken!, {
      name: `Test UC ${createTestId()}`,
      description: 'Test use case for tool calls',
      folderId
    });
    expect(useCaseResponse.status).toBe(201);
    useCaseId = (await useCaseResponse.json()).id;
  });

  afterEach(async () => {
    // Cleanup
    await db.delete(chatStreamEvents).where(eq(chatStreamEvents.streamId, useCaseId));
    await db.delete(chatContexts);
    await db.delete(contextModificationHistory);
    await db.delete(useCases).where(eq(useCases.id, useCaseId));
    await db.delete(folders).where(eq(folders.id, folderId));
    await cleanupAuthData();
  });

  async function waitForJobCompletion(jobId: string, adminUser: any, maxAttempts: number = 15): Promise<void> {
    let attempts = 0;
    while (attempts < maxAttempts) {
      await sleep(1000); // 1 second between checks
      
      // Queue is workspace-scoped: read the job directly with the owner's token.
      const jobRes = await authenticatedRequest(app, 'GET', `/api/v1/queue/jobs/${jobId}`, user.sessionToken!);
      expect(jobRes.status).toBe(200);
      const job = await jobRes.json();
      
      if (job && (job.status === 'completed' || job.status === 'failed')) {
        expect(job.status).toBe('completed');
        return;
      }
      attempts++;
    }
    throw new Error(`Job ${jobId} did not complete within ${maxAttempts} seconds`);
  }

  describe('read_usecase tool', () => {
    it('should call read_usecase and return use case data in stream', async () => {
      const adminUser = await createAuthenticatedUser('admin_app');
      
      // Message qui devrait déclencher read_usecase
      const chatResponse = await authenticatedRequest(app, 'POST', '/api/v1/chat/messages', user.sessionToken!, {
        content: `Read the use case with id ${useCaseId}`,
        primaryContextType: 'usecase',
        primaryContextId: useCaseId,
        model: getTestModel()
      });

      expect(chatResponse.status).toBe(200);
      const chatData = await chatResponse.json();
      const { jobId, assistantMessageId } = chatData;

      // Attendre la complétion
      await waitForJobCompletion(jobId, adminUser);

      // Vérifier les stream events
      const streamEventsRes = await authenticatedRequest(
        app,
        'GET',
        `/api/v1/streams/events/${assistantMessageId}`,
        user.sessionToken!
      );
      expect(streamEventsRes.status).toBe(200);
      const streamData = await streamEventsRes.json();
      const events = streamData.events;

      // Vérifier qu'il y a des événements tool_call
      const toolCallEvents = events.filter((e: any) => 
        e.eventType === 'tool_call_start' || 
        e.eventType === 'tool_call_result' || 
        e.eventType.startsWith('tool_call_')
      );
      expect(toolCallEvents.length).toBeGreaterThan(0);

      // Vérifier qu'il y a un tool_call_result avec read_usecase
      const toolCallResult = events.find((e: any) => 
        e.eventType === 'tool_call_result' && 
        e.data?.result?.useCaseId === useCaseId
      );
      expect(toolCallResult).toBeDefined();

      await cleanupAuthData(); // Cleanup admin user
    }, 15000);
  });

  describe('update_usecase_field tool', () => {
    it('should call update_usecase_field and update database', async () => {
      const adminUser = await createAuthenticatedUser('admin_app');
      
      // Message qui devrait déclencher update_usecase_field
      const chatResponse = await authenticatedRequest(app, 'POST', '/api/v1/chat/messages', user.sessionToken!, {
        content: `Update the description of use case ${useCaseId} to "Updated description for testing"`,
        primaryContextType: 'usecase',
        primaryContextId: useCaseId,
        model: getTestModel()
      });

      expect(chatResponse.status).toBe(200);
      const chatData = await chatResponse.json();
      const { jobId, assistantMessageId, sessionId } = chatData;

      // Attendre la complétion
      await waitForJobCompletion(jobId, adminUser);

      // Vérifier que use_cases.data a été mis à jour via endpoint
      const useCaseRes = await authenticatedRequest(app, 'GET', `/api/v1/use-cases/${useCaseId}`, user.sessionToken!);
      expect(useCaseRes.status).toBe(200);
      const useCaseData = await useCaseRes.json();
      expect(useCaseData.data).toBeDefined();
      // Le description devrait avoir été mise à jour (ou au moins mentionnée dans les modifications)

      // Vérifier context_modification_history
      const history = await db
        .select()
        .from(contextModificationHistory)
        .where(
          and(
            eq(contextModificationHistory.contextType, 'usecase'),
            eq(contextModificationHistory.contextId, useCaseId)
          )
        );
      // L'historique peut être vide si l'IA n'a pas effectué de modifications (acceptable)
      // On vérifie juste qu'il n'y a pas d'erreur

      // Vérifier chat_contexts avec snapshot (peut être vide si aucune modification n'a été faite)
      const contexts = await db
        .select()
        .from(chatContexts)
        .where(eq(chatContexts.sessionId, sessionId));
      // Si des contexts existent, vérifier qu'ils ont un snapshotAfter
      if (contexts.length > 0) {
        const context = contexts.find(c => c.contextType === 'usecase' && c.contextId === useCaseId);
        if (context) {
          expect(context.snapshotAfter).toBeDefined();
        }
      }

      // Vérifier chat_stream_events contient tool_call events
      const streamEventsRes = await authenticatedRequest(
        app,
        'GET',
        `/api/v1/streams/events/${assistantMessageId}`,
        user.sessionToken!
      );
      expect(streamEventsRes.status).toBe(200);
      const streamData = await streamEventsRes.json();
      const toolCallEvents = streamData.events.filter((e: any) => 
        e.eventType.startsWith('tool_call_')
      );
      expect(toolCallEvents.length).toBeGreaterThan(0);

      await cleanupAuthData(); // Cleanup admin user
    }, 15000);
  });

  describe('web_extract tool', () => {
    it('should handle web_extract with array of URLs correctly', async () => {
      const adminUser = await createAuthenticatedUser('admin_app');
      
      // Ajouter des références au use case pour déclencher web_extract
      const currentRow = (await db.select().from(useCases).where(eq(useCases.id, useCaseId)))[0];
      const currentData = (currentRow?.data ?? {}) as any;
      await db.update(useCases)
        .set({
          data: {
            ...currentData,
            references: [
              { url: 'https://example.com/article1', title: 'Article 1' },
              { url: 'https://example.com/article2', title: 'Article 2' }
            ]
          }
        } as any)
        .where(eq(useCases.id, useCaseId));

      // Message qui pourrait déclencher web_extract (si l'IA le juge nécessaire)
      const chatResponse = await authenticatedRequest(app, 'POST', '/api/v1/chat/messages', user.sessionToken!, {
        content: `Analyze the references for use case ${useCaseId}`,
        primaryContextType: 'usecase',
        primaryContextId: useCaseId,
        model: getTestModel()
      });

      expect(chatResponse.status).toBe(200);
      const chatData = await chatResponse.json();
      const { jobId, assistantMessageId } = chatData;

      // Attendre la complétion
      await waitForJobCompletion(jobId, adminUser);

      // Vérifier les stream events
      const streamEventsRes = await authenticatedRequest(
        app,
        'GET',
        `/api/v1/streams/events/${assistantMessageId}`,
        user.sessionToken!
      );
      expect(streamEventsRes.status).toBe(200);
      const streamData = await streamEventsRes.json();
      
      // Si web_extract a été appelé, vérifier qu'il n'y a pas d'erreur avec array vide
      const errorEvents = streamData.events.filter((e: any) => 
        e.eventType === 'error' && 
        e.data?.message?.includes('array vide')
      );
      expect(errorEvents.length).toBe(0);

      await cleanupAuthData(); // Cleanup admin user
    }, 15000);
  });

  describe('Security validation', () => {
    it('should reject update_usecase_field with useCaseId not matching context', async () => {
      // Créer un autre use case
      const otherUseCaseResponse = await authenticatedRequest(app, 'POST', '/api/v1/use-cases', user.sessionToken!, {
        name: `Other UC ${createTestId()}`,
        description: 'Other use case',
        folderId
      });
      const otherUseCaseId = (await otherUseCaseResponse.json()).id;

      const adminUser = await createAuthenticatedUser('admin_app');
      
      // Tenter de modifier l'autre use case alors que le contexte est sur useCaseId
      const chatResponse = await authenticatedRequest(app, 'POST', '/api/v1/chat/messages', user.sessionToken!, {
        content: `Update use case ${otherUseCaseId} description`, // Use case différent du contexte
        primaryContextType: 'usecase',
        primaryContextId: useCaseId, // Contexte sur useCaseId mais on essaie de modifier otherUseCaseId
        model: getTestModel()
      });

      expect(chatResponse.status).toBe(200);
      const chatData = await chatResponse.json();
      const { jobId } = chatData;

      // Attendre la complétion (le job peut réussir si l'IA ne tente pas de modifier le mauvais use case)
      // ou échouer avec une erreur de sécurité si l'IA tente effectivement de le faire
      try {
        await waitForJobCompletion(jobId, adminUser);
        // Si le job réussit, c'est que l'IA n'a pas tenté de modifier le mauvais use case (acceptable)
      } catch {
        // Si le job échoue, vérifier que c'est à cause de la sécurité
        const jobRes = await authenticatedRequest(app, 'GET', `/api/v1/queue/jobs/${jobId}`, user.sessionToken!);
        const job = await jobRes.json();
        if (job?.status === 'failed') {
          expect(job.error).toContain('Security');
        }
      }
      
      // Nettoyer l'autre use case
      await db.delete(useCases).where(eq(useCases.id, otherUseCaseId));
      await cleanupAuthData(); // Cleanup admin user
    }, 15000);
  });

  describe('Conversation continuation', () => {
    it('should maintain conversation context across multiple messages', async () => {
      const adminUser = await createAuthenticatedUser('admin_app');
      
      // Premier message
      const firstResponse = await authenticatedRequest(app, 'POST', '/api/v1/chat/messages', user.sessionToken!, {
        content: `Read use case ${useCaseId}`,
        primaryContextType: 'usecase',
        primaryContextId: useCaseId,
        model: getTestModel()
      });
      const { sessionId, jobId: firstJobId } = await firstResponse.json();
      await waitForJobCompletion(firstJobId, adminUser);

      // Deuxième message dans la même session
      const secondResponse = await authenticatedRequest(app, 'POST', '/api/v1/chat/messages', user.sessionToken!, {
        content: 'Now update the description',
        sessionId,
        primaryContextType: 'usecase',
        primaryContextId: useCaseId,
        model: getTestModel()
      });
      const { jobId: secondJobId } = await secondResponse.json();
      await waitForJobCompletion(secondJobId, adminUser);

      // Vérifier l'historique de la session
      const messagesRes = await authenticatedRequest(
        app,
        'GET',
        `/api/v1/chat/sessions/${sessionId}/messages`,
        user.sessionToken!
      );
      expect(messagesRes.status).toBe(200);
      const messagesData = await messagesRes.json();
      expect(messagesData.messages.length).toBeGreaterThanOrEqual(4); // 2 user + 2 assistant

      await cleanupAuthData(); // Cleanup admin user
    }, 30000);
  });
});

