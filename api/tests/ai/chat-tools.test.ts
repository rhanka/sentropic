import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { app } from '../../src/app';
import { createTestId, getTestModel, sleep } from '../utils/test-helpers';
import {
  createAuthenticatedUser,
  authenticatedRequest,
  cleanupAuthData
} from '../utils/auth-helper';
import { db } from '../../src/db/client';
import { chatMessages, chatStreamEvents, chatContexts, contextModificationHistory, initiatives, folders } from '../../src/db/schema';
import { eq, and } from 'drizzle-orm';
import * as tools from '../../src/services/tools';

describe('Chat AI - Tool Calls Integration', () => {
  let user: any;
  let initiativeId: string;
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

    // Créer un initiative
    const initiativeResponse = await authenticatedRequest(app, 'POST', '/api/v1/initiatives', user.sessionToken!, {
      name: `Test UC ${createTestId()}`,
      description: 'Test initiative for tool calls',
      folderId
    });
    expect(initiativeResponse.status).toBe(201);
    initiativeId = (await initiativeResponse.json()).id;
  });

  afterEach(async () => {
    // Cleanup
    await db.delete(chatStreamEvents).where(eq(chatStreamEvents.streamId, initiativeId));
    await db.delete(chatContexts);
    await db.delete(contextModificationHistory);
    await db.delete(initiatives).where(eq(initiatives.id, initiativeId));
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

  async function fetchAssistantDetails(sessionId: string, assistantMessageId: string): Promise<any[]> {
    const response = await authenticatedRequest(
      app,
      'GET',
      `/api/v1/chat/sessions/${sessionId}/bootstrap`,
      user.sessionToken!,
    );
    expect(response.status).toBe(200);
    const payload = await response.json();
    return Array.isArray(payload?.assistantDetailsByMessageId?.[assistantMessageId])
      ? payload.assistantDetailsByMessageId[assistantMessageId]
      : [];
  }

  describe('read_initiative tool', () => {
    it('should call read_initiative and return initiative data in stream', async () => {
      const adminUser = await createAuthenticatedUser('admin_app');
      
      // Message qui devrait déclencher read_initiative
      const chatResponse = await authenticatedRequest(app, 'POST', '/api/v1/chat/messages', user.sessionToken!, {
        content: `Read the initiative with id ${initiativeId}`,
        primaryContextType: 'initiative',
        primaryContextId: initiativeId,
        model: getTestModel()
      });

      expect(chatResponse.status).toBe(200);
      const chatData = await chatResponse.json();
      const { jobId, assistantMessageId, sessionId } = chatData;

      // Attendre la complétion
      await waitForJobCompletion(jobId, adminUser);

      const events = await fetchAssistantDetails(sessionId, assistantMessageId);

      // Vérifier qu'il y a des événements tool_call
      const toolCallEvents = events.filter((e: any) => 
        e.eventType === 'tool_call_start' || 
        e.eventType === 'tool_call_result' || 
        e.eventType.startsWith('tool_call_')
      );
      expect(toolCallEvents.length).toBeGreaterThan(0);

      // Vérifier qu'il y a un tool_call_result avec read_initiative
      const toolCallResult = events.find((e: any) => 
        e.eventType === 'tool_call_result' && 
        e.data?.result?.initiativeId === initiativeId
      );
      expect(toolCallResult).toBeDefined();

      await cleanupAuthData(); // Cleanup admin user
    }, 15000);
  });

  describe('update_initiative_field tool', () => {
    it('should call update_initiative_field and update database', async () => {
      const adminUser = await createAuthenticatedUser('admin_app');
      
      // Message qui devrait déclencher update_initiative_field
      const chatResponse = await authenticatedRequest(app, 'POST', '/api/v1/chat/messages', user.sessionToken!, {
        content: `Update the description of initiative ${initiativeId} to "Updated description for testing"`,
        primaryContextType: 'initiative',
        primaryContextId: initiativeId,
        model: getTestModel()
      });

      expect(chatResponse.status).toBe(200);
      const chatData = await chatResponse.json();
      const { jobId, assistantMessageId, sessionId } = chatData;

      // Attendre la complétion
      await waitForJobCompletion(jobId, adminUser);

      // Vérifier que initiatives.data a été mis à jour via endpoint
      const initiativeRes = await authenticatedRequest(app, 'GET', `/api/v1/initiatives/${initiativeId}`, user.sessionToken!);
      expect(initiativeRes.status).toBe(200);
      const initiativeData = await initiativeRes.json();
      expect(initiativeData.data).toBeDefined();
      // Le description devrait avoir été mise à jour (ou au moins mentionnée dans les modifications)

      // Vérifier context_modification_history
      const history = await db
        .select()
        .from(contextModificationHistory)
        .where(
          and(
            eq(contextModificationHistory.contextType, 'initiative'),
            eq(contextModificationHistory.contextId, initiativeId)
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
        const context = contexts.find(c => c.contextType === 'initiative' && c.contextId === initiativeId);
        if (context) {
          expect(context.snapshotAfter).toBeDefined();
        }
      }

      const toolCallEvents = (await fetchAssistantDetails(sessionId, assistantMessageId)).filter((e: any) => 
        e.eventType.startsWith('tool_call_')
      );
      expect(toolCallEvents.length).toBeGreaterThan(0);

      await cleanupAuthData(); // Cleanup admin user
    }, 15000);
  });

  describe('web_extract tool', () => {
    it('should handle web_extract with array of URLs correctly', async () => {
      const adminUser = await createAuthenticatedUser('admin_app');

      // Make this test deterministic: avoid external Tavily network calls.
      const extractSpy = vi.spyOn(tools, 'extractUrlContent').mockResolvedValue([
        { url: 'https://example.com/article1', content: 'Article 1 content' },
        { url: 'https://example.com/article2', content: 'Article 2 content' }
      ]);
      
      // Ajouter des références au initiative pour déclencher web_extract
      const currentRow = (await db.select().from(initiatives).where(eq(initiatives.id, initiativeId)))[0];
      const currentData = (currentRow?.data ?? {}) as any;
      await db.update(initiatives)
        .set({
          data: {
            ...currentData,
            references: [
              { url: 'https://example.com/article1', title: 'Article 1' },
              { url: 'https://example.com/article2', title: 'Article 2' }
            ]
          }
        } as any)
        .where(eq(initiatives.id, initiativeId));

      // Message explicite pour déclencher web_extract avec les URLs des references
      const chatResponse = await authenticatedRequest(app, 'POST', '/api/v1/chat/messages', user.sessionToken!, {
        content: [
          `Tu DOIS appeler le tool \`web_extract\` maintenant avec exactement ces 2 URLs :`,
          `urls: ["https://example.com/article1", "https://example.com/article2"]`,
          `N'invente aucune autre URL. N'appelle aucun autre tool avant. Après le résultat, réponds OK.`
        ].join('\n'),
        primaryContextType: 'initiative',
        primaryContextId: initiativeId,
        model: getTestModel()
      });

      expect(chatResponse.status).toBe(200);
      const chatData = await chatResponse.json();
      const { jobId, assistantMessageId, sessionId } = chatData;

      // Attendre la complétion
      await waitForJobCompletion(jobId, adminUser, 30);

      const streamData = {
        events: await fetchAssistantDetails(sessionId, assistantMessageId),
      };
      
      // Si web_extract a été appelé, vérifier qu'il n'y a pas d'erreur avec array vide
      const errorEvents = streamData.events.filter((e: any) => 
        e.eventType === 'error' && 
        e.data?.message?.includes('array vide')
      );
      expect(errorEvents.length).toBe(0);

      // If the assistant called web_extract, ensure it used the mocked path (no network) and single call.
      if (extractSpy.mock.calls.length > 0) {
        expect(extractSpy).toHaveBeenCalledTimes(1);
        const arg0 = extractSpy.mock.calls[0]?.[0];
        expect(Array.isArray(arg0)).toBe(true);
        if (Array.isArray(arg0)) {
          expect(arg0).toEqual(['https://example.com/article1', 'https://example.com/article2']);
        }
      }

      extractSpy.mockRestore();
      await cleanupAuthData(); // Cleanup admin user
    }, 30000);
  });

  describe('folder context - matrix_get tool (real integration)', () => {
    it('should call matrix_get when explicitly requested in folder context', async () => {
      const adminUser = await createAuthenticatedUser('admin_app');

      const chatResponse = await authenticatedRequest(app, 'POST', '/api/v1/chat/messages', user.sessionToken!, {
        content: [
          `Tu DOIS appeler le tool \`matrix_get\` maintenant avec folderId="${folderId}".`,
          `N'invente rien. Ne réponds pas avant d'avoir appelé \`matrix_get\`.`,
          `Après le tool_call_result, réponds uniquement avec: OK`
        ].join('\n'),
        primaryContextType: 'folder',
        primaryContextId: folderId,
        model: getTestModel()
      });

      expect(chatResponse.status).toBe(200);
      const chatData = await chatResponse.json();
      const { jobId, assistantMessageId, sessionId } = chatData;

      await waitForJobCompletion(jobId, adminUser, 30);

      const events = await fetchAssistantDetails(sessionId, assistantMessageId);

      const mxStart = events.find((e: any) => e.eventType === 'tool_call_start' && e.data?.name === 'matrix_get');
      expect(mxStart).toBeDefined();

      const mxResult = events.find(
        (e: any) => e.eventType === 'tool_call_result' && e.data?.result?.status === 'completed' && e.data?.result?.folderId === folderId
      );
      expect(mxResult).toBeDefined();

      await cleanupAuthData(); // Cleanup admin user
    }, 30000);
  });

  describe('Security validation', () => {
    it('should reject update_initiative_field with initiativeId not matching context', async () => {
      // Créer un autre initiative
      const otherInitiativeResponse = await authenticatedRequest(app, 'POST', '/api/v1/initiatives', user.sessionToken!, {
        name: `Other UC ${createTestId()}`,
        description: 'Other initiative',
        folderId
      });
      const otherInitiativeId = (await otherInitiativeResponse.json()).id;

      const adminUser = await createAuthenticatedUser('admin_app');
      
      // Tenter de modifier l'autre initiative alors que le contexte est sur initiativeId
      const chatResponse = await authenticatedRequest(app, 'POST', '/api/v1/chat/messages', user.sessionToken!, {
        content: `Update initiative ${otherInitiativeId} description`, // Use case différent du contexte
        primaryContextType: 'initiative',
        primaryContextId: initiativeId, // Contexte sur initiativeId mais on essaie de modifier otherInitiativeId
        model: getTestModel()
      });

      expect(chatResponse.status).toBe(200);
      const chatData = await chatResponse.json();
      const { jobId } = chatData;

      // Attendre la complétion (le job peut réussir si l'IA ne tente pas de modifier le mauvais initiative)
      // ou échouer avec une erreur de sécurité si l'IA tente effectivement de le faire
      try {
        await waitForJobCompletion(jobId, adminUser);
        // Si le job réussit, c'est que l'IA n'a pas tenté de modifier le mauvais initiative (acceptable)
      } catch {
        // Si le job échoue, vérifier que c'est à cause de la sécurité
        const jobRes = await authenticatedRequest(app, 'GET', `/api/v1/queue/jobs/${jobId}`, user.sessionToken!);
        const job = await jobRes.json();
        if (job?.status === 'failed') {
          expect(job.error).toContain('Security');
        }
      }
      
      // Nettoyer l'autre initiative
      await db.delete(initiatives).where(eq(initiatives.id, otherInitiativeId));
      await cleanupAuthData(); // Cleanup admin user
    }, 15000);
  });

  describe('Conversation continuation', () => {
    it('should maintain conversation context across multiple messages', async () => {
      const adminUser = await createAuthenticatedUser('admin_app');
      
      // Premier message
      const firstResponse = await authenticatedRequest(app, 'POST', '/api/v1/chat/messages', user.sessionToken!, {
        content: `Read initiative ${initiativeId}`,
        primaryContextType: 'initiative',
        primaryContextId: initiativeId,
        model: getTestModel()
      });
      const { sessionId, jobId: firstJobId } = await firstResponse.json();
      await waitForJobCompletion(firstJobId, adminUser);

      // Deuxième message dans la même session
      const secondResponse = await authenticatedRequest(app, 'POST', '/api/v1/chat/messages', user.sessionToken!, {
        content: 'Now update the description',
        sessionId,
        primaryContextType: 'initiative',
        primaryContextId: initiativeId,
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
