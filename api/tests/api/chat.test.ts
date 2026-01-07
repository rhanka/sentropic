import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { app } from '../../src/app';
import { createTestId } from '../utils/test-helpers';
import { 
  createAuthenticatedUser, 
  authenticatedRequest, 
  cleanupAuthData 
} from '../utils/auth-helper';
import { db } from '../../src/db/client';
import { chatSessions, chatMessages, jobQueue } from '../../src/db/schema';
import { eq } from 'drizzle-orm';
import { queueManager } from '../../src/services/queue-manager';
import { vi } from 'vitest';

describe('Chat API Endpoints', () => {
  let user: any;
  let processJobsSpy: any;

  beforeEach(async () => {
    // Important: endpoint tests should validate enqueueing without running async workers.
    // Running the queue during tests can introduce cross-test races (sessions/messages cleaned up while jobs still run).
    if (!processJobsSpy) {
      processJobsSpy = vi.spyOn(queueManager, 'processJobs').mockResolvedValue(undefined);
    }
    user = await createAuthenticatedUser('editor');
  });

  afterEach(async () => {
    await cleanupAuthData();
  });

  afterAll(async () => {
    try {
      processJobsSpy?.mockRestore?.();
    } catch {
      // ignore
    }
  });

  describe('POST /api/v1/chat/messages', () => {
    it('should create a new session if sessionId is not provided', async () => {
      const response = await authenticatedRequest(app, 'POST', '/api/v1/chat/messages', user.sessionToken!, {
        content: 'Hello, this is a test message'
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.sessionId).toBeDefined();
      expect(data.userMessageId).toBeDefined();
      expect(data.assistantMessageId).toBeDefined();
      expect(data.streamId).toBeDefined();
      expect(data.jobId).toBeDefined();
    });

    it('should use existing session if sessionId is provided', async () => {
      // Créer une première session
      const firstResponse = await authenticatedRequest(app, 'POST', '/api/v1/chat/messages', user.sessionToken!, {
        content: 'First message'
      });
      const firstData = await firstResponse.json();
      const sessionId = firstData.sessionId;

      // Envoyer un deuxième message dans la même session
      const secondResponse = await authenticatedRequest(app, 'POST', '/api/v1/chat/messages', user.sessionToken!, {
        sessionId,
        content: 'Second message'
      });

      expect(secondResponse.status).toBe(200);
      const secondData = await secondResponse.json();
      expect(secondData.sessionId).toBe(sessionId);
    });

    it('should enqueue a chat_message job', async () => {
      const response = await authenticatedRequest(app, 'POST', '/api/v1/chat/messages', user.sessionToken!, {
        content: 'Test message for job'
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.jobId).toBeDefined();

      // Vérifier que le job existe dans la queue
      const jobs = await db
        .select()
        .from(jobQueue)
        .where(eq(jobQueue.id, data.jobId));

      expect(jobs.length).toBe(1);
      expect(jobs[0].type).toBe('chat_message');
    });

    it('should create user message in database', async () => {
      const response = await authenticatedRequest(app, 'POST', '/api/v1/chat/messages', user.sessionToken!, {
        content: 'User message content'
      });

      const data = await response.json();
      const userMessages = await db
        .select()
        .from(chatMessages)
        .where(eq(chatMessages.id, data.userMessageId));

      expect(userMessages.length).toBe(1);
      expect(userMessages[0].role).toBe('user');
      expect(userMessages[0].content).toBe('User message content');
    });

    it('should create assistant placeholder message', async () => {
      const response = await authenticatedRequest(app, 'POST', '/api/v1/chat/messages', user.sessionToken!, {
        content: 'Test message'
      });

      const data = await response.json();
      const assistantMessages = await db
        .select()
        .from(chatMessages)
        .where(eq(chatMessages.id, data.assistantMessageId));

      expect(assistantMessages.length).toBe(1);
      expect(assistantMessages[0].role).toBe('assistant');
    });

    it('should set primaryContextType and primaryContextId when provided', async () => {
      const useCaseId = createTestId();
      const response = await authenticatedRequest(app, 'POST', '/api/v1/chat/messages', user.sessionToken!, {
        content: 'Message with context',
        primaryContextType: 'usecase',
        primaryContextId: useCaseId
      });

      expect(response.status).toBe(200);
      const data = await response.json();

      const sessions = await db
        .select()
        .from(chatSessions)
        .where(eq(chatSessions.id, data.sessionId));

      expect(sessions.length).toBe(1);
      expect(sessions[0].primaryContextType).toBe('usecase');
      expect(sessions[0].primaryContextId).toBe(useCaseId);
    });

    it('should return 401 without authentication', async () => {
      const response = await app.request('/api/v1/chat/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Test' })
      });

      expect(response.status).toBe(401);
    });

    it('should return 400 if content is empty', async () => {
      const response = await authenticatedRequest(app, 'POST', '/api/v1/chat/messages', user.sessionToken!, {
        content: ''
      });

      expect(response.status).toBe(400);
    });
  });

  describe('GET /api/v1/chat/sessions', () => {
    it('should list sessions for the authenticated user', async () => {
      // Créer quelques sessions
      await authenticatedRequest(app, 'POST', '/api/v1/chat/messages', user.sessionToken!, {
        content: 'Message 1'
      });
      await authenticatedRequest(app, 'POST', '/api/v1/chat/messages', user.sessionToken!, {
        content: 'Message 2'
      });

      const response = await authenticatedRequest(app, 'GET', '/api/v1/chat/sessions', user.sessionToken!);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.sessions).toBeDefined();
      expect(Array.isArray(data.sessions)).toBe(true);
      expect(data.sessions.length).toBeGreaterThanOrEqual(2);
    });

    it('should only return sessions for the authenticated user', async () => {
      // Créer quelques sessions pour le user actuel
      await authenticatedRequest(app, 'POST', '/api/v1/chat/messages', user.sessionToken!, {
        content: 'User message 1'
      });
      await authenticatedRequest(app, 'POST', '/api/v1/chat/messages', user.sessionToken!, {
        content: 'User message 2'
      });

      // Récupérer les sessions
      const response = await authenticatedRequest(app, 'GET', '/api/v1/chat/sessions', user.sessionToken!);
      const data = await response.json();

      // Vérifier que toutes les sessions appartiennent au bon user
      for (const session of data.sessions) {
        expect(session.userId).toBe(user.id);
      }
    });

    it('should return 401 without authentication', async () => {
      const response = await app.request('/api/v1/chat/sessions', {
        method: 'GET'
      });

      expect(response.status).toBe(401);
    });
  });

  describe('GET /api/v1/chat/sessions/:id/messages', () => {
    it('should list messages ordered by sequence', async () => {
      const createResponse = await authenticatedRequest(app, 'POST', '/api/v1/chat/messages', user.sessionToken!, {
        content: 'First message'
      });
      const { sessionId } = await createResponse.json();

      // Envoyer un deuxième message
      await authenticatedRequest(app, 'POST', '/api/v1/chat/messages', user.sessionToken!, {
        sessionId,
        content: 'Second message'
      });

      const response = await authenticatedRequest(app, 'GET', `/api/v1/chat/sessions/${sessionId}/messages`, user.sessionToken!);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.messages.length).toBeGreaterThanOrEqual(4); // 2 user + 2 assistant placeholders

      // Vérifier l'ordre
      for (let i = 1; i < data.messages.length; i++) {
        expect(data.messages[i].sequence).toBeGreaterThanOrEqual(data.messages[i - 1].sequence);
      }
    });

    it('should return error for non-existent session', async () => {
      const response = await authenticatedRequest(app, 'GET', '/api/v1/chat/sessions/non-existent-id/messages', user.sessionToken!);

      // Le service throw une Error qui peut être convertie en 500 par Hono
      expect([404, 500]).toContain(response.status);
    });

    it('should return 401 without authentication', async () => {
      const createResponse = await authenticatedRequest(app, 'POST', '/api/v1/chat/messages', user.sessionToken!, {
        content: 'Test message'
      });
      const { sessionId } = await createResponse.json();

      const response = await authenticatedRequest(
        app,
        'GET',
        `/api/v1/chat/sessions/${sessionId}/messages`,
        null // Pas de token
      );

      expect(response.status).toBe(401);
    });

    it('should return error when accessing another user session', async () => {
      // Utiliser un ID de session qui n'existe pas (simule un accès à une session d'un autre user)
      // Le service vérifie userId, donc une session inexistante retourne une erreur
      const nonExistentSessionId = createTestId();
      const response = await authenticatedRequest(
        app,
        'GET',
        `/api/v1/chat/sessions/${nonExistentSessionId}/messages`,
        user.sessionToken!
      );

      // Le service vérifie userId, donc devrait retourner une erreur (500 ou 404)
      expect([404, 500]).toContain(response.status);
    });
  });

  describe('GET /api/v1/chat/sessions/:id/stream-events', () => {
    it('should return stream events structure for a session', async () => {
      const createResponse = await authenticatedRequest(app, 'POST', '/api/v1/chat/messages', user.sessionToken!, {
        content: 'Test message'
      });
      const { sessionId } = await createResponse.json();

      const response = await authenticatedRequest(app, 'GET', `/api/v1/chat/sessions/${sessionId}/stream-events`, user.sessionToken!);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.sessionId).toBe(sessionId);
      expect(data.streams).toBeDefined();
      expect(Array.isArray(data.streams)).toBe(true);
    });

    it('should respect limitMessages and limitEventsPerMessage parameters', async () => {
      const createResponse = await authenticatedRequest(app, 'POST', '/api/v1/chat/messages', user.sessionToken!, {
        content: 'Test'
      });
      const { sessionId } = await createResponse.json();

      const response = await authenticatedRequest(
        app,
        'GET',
        `/api/v1/chat/sessions/${sessionId}/stream-events?limitMessages=1&limitEventsPerMessage=5`,
        user.sessionToken!
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.streams).toBeDefined();
    });
  });

  describe('GET /api/v1/chat/messages/:id/stream-events', () => {
    it('should return stream events structure for a specific message', async () => {
      const createResponse = await authenticatedRequest(app, 'POST', '/api/v1/chat/messages', user.sessionToken!, {
        content: 'Test message'
      });
      const { assistantMessageId } = await createResponse.json();

      const response = await authenticatedRequest(
        app,
        'GET',
        `/api/v1/chat/messages/${assistantMessageId}/stream-events`,
        user.sessionToken!
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.messageId).toBe(assistantMessageId);
      expect(data.streamId).toBe(assistantMessageId);
      expect(data.events).toBeDefined();
      expect(Array.isArray(data.events)).toBe(true);
    });

    it('should respect sinceSequence and limit parameters', async () => {
      const createResponse = await authenticatedRequest(app, 'POST', '/api/v1/chat/messages', user.sessionToken!, {
        content: 'Test'
      });
      const { assistantMessageId } = await createResponse.json();

      const response = await authenticatedRequest(
        app,
        'GET',
        `/api/v1/chat/messages/${assistantMessageId}/stream-events?sinceSequence=0&limit=10`,
        user.sessionToken!
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.events.length).toBeLessThanOrEqual(10);
    });
  });

  describe('DELETE /api/v1/chat/sessions/:id', () => {
    it('should delete a session with cascade', async () => {
      const createResponse = await authenticatedRequest(app, 'POST', '/api/v1/chat/messages', user.sessionToken!, {
        content: 'Test message'
      });
      const { sessionId } = await createResponse.json();

      const deleteResponse = await authenticatedRequest(app, 'DELETE', `/api/v1/chat/sessions/${sessionId}`, user.sessionToken!);

      expect(deleteResponse.status).toBe(200);
      const deleteData = await deleteResponse.json();
      expect(deleteData.ok).toBe(true);

      // Vérifier que la session est supprimée
      const sessions = await db
        .select()
        .from(chatSessions)
        .where(eq(chatSessions.id, sessionId));

      expect(sessions.length).toBe(0);

      // Vérifier que les messages sont supprimés (cascade)
      const messages = await db
        .select()
        .from(chatMessages)
        .where(eq(chatMessages.sessionId, sessionId));

      expect(messages.length).toBe(0);
    });

    it('should return error for non-existent session', async () => {
      const response = await authenticatedRequest(app, 'DELETE', '/api/v1/chat/sessions/non-existent-id', user.sessionToken!);

      // Le service throw une Error qui peut être convertie en 500 par Hono
      expect([404, 500]).toContain(response.status);
    });

    it('should return 401 without authentication', async () => {
      const createResponse = await authenticatedRequest(app, 'POST', '/api/v1/chat/messages', user.sessionToken!, {
        content: 'Test message'
      });
      const { sessionId } = await createResponse.json();

      const response = await authenticatedRequest(
        app,
        'DELETE',
        `/api/v1/chat/sessions/${sessionId}`,
        null // Pas de token
      );

      expect(response.status).toBe(401);
    });

    it('should return error when deleting another user session', async () => {
      // Utiliser un ID de session qui n'existe pas (simule un accès à une session d'un autre user)
      // Le service vérifie userId, donc une session inexistante retourne une erreur
      const nonExistentSessionId = createTestId();
      const response = await authenticatedRequest(
        app,
        'DELETE',
        `/api/v1/chat/sessions/${nonExistentSessionId}`,
        user.sessionToken!
      );

      // Le service vérifie userId, donc devrait retourner une erreur (500 ou 404)
      expect([404, 500]).toContain(response.status);
    });
  });

  describe('GET /api/v1/chat/sessions/:id/stream-events', () => {
    it('should return 401 without authentication', async () => {
      const createResponse = await authenticatedRequest(app, 'POST', '/api/v1/chat/messages', user.sessionToken!, {
        content: 'Test message'
      });
      const { sessionId } = await createResponse.json();

      const response = await authenticatedRequest(
        app,
        'GET',
        `/api/v1/chat/sessions/${sessionId}/stream-events`,
        null // Pas de token
      );

      expect(response.status).toBe(401);
    });

    it('should return error for non-existent session', async () => {
      const response = await authenticatedRequest(
        app,
        'GET',
        '/api/v1/chat/sessions/non-existent-id/stream-events',
        user.sessionToken!
      );

      expect([404, 500]).toContain(response.status);
    });
  });

  describe('GET /api/v1/chat/messages/:id/stream-events', () => {
    it('should return 404 for non-existent message', async () => {
      const response = await authenticatedRequest(
        app,
        'GET',
        '/api/v1/chat/messages/non-existent-message-id/stream-events',
        user.sessionToken!
      );

      expect(response.status).toBe(404);
    });

    it('should return 401 without authentication', async () => {
      const createResponse = await authenticatedRequest(app, 'POST', '/api/v1/chat/messages', user.sessionToken!, {
        content: 'Test message'
      });
      const { assistantMessageId } = await createResponse.json();

      const response = await authenticatedRequest(
        app,
        'GET',
        `/api/v1/chat/messages/${assistantMessageId}/stream-events`,
        null // Pas de token
      );

      expect(response.status).toBe(401);
    });
  });
});

