import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { app } from '../../src/app';
import { createTestId } from '../utils/test-helpers';
import { 
  createAuthenticatedUser, 
  authenticatedRequest, 
  cleanupAuthData 
} from '../utils/auth-helper';
import { db } from '../../src/db/client';
import { chatStreamEvents, chatMessages, chatSessions, users } from '../../src/db/schema';
import { eq } from 'drizzle-orm';
import { writeStreamEvent, getNextSequence } from '../../src/services/stream-service';

describe('Streams API Endpoints', () => {
  let user: any;
  let testUserId: string;
  let testSessionId: string;
  let testMessageId: string;
  let testStreamId: string;

  beforeEach(async () => {
    user = await createAuthenticatedUser('editor');
    
    // Créer un streamId pour les tests
    testStreamId = `test_stream_${createTestId()}`;
    
    // Créer un message de test avec streamId = messageId
    testUserId = user.id;
    testSessionId = createTestId();
    testMessageId = createTestId();
    
    await db.insert(chatSessions).values({
      id: testSessionId,
      userId: testUserId,
      primaryContextType: 'usecase',
      primaryContextId: createTestId(),
      createdAt: new Date(),
      updatedAt: new Date()
    });
    
    await db.insert(chatMessages).values({
      id: testMessageId,
      sessionId: testSessionId,
      role: 'assistant',
      content: 'Test message',
      sequence: 1,
      createdAt: new Date()
    });

    // Créer quelques événements de stream pour les tests
    await writeStreamEvent(testStreamId, 'content_delta', { delta: 'Hello' }, 1, testMessageId);
    await writeStreamEvent(testStreamId, 'content_delta', { delta: ' World' }, 2, testMessageId);
    await writeStreamEvent(testStreamId, 'done', {}, 3, testMessageId);
  });

  afterEach(async () => {
    // Cleanup stream events
    await db.delete(chatStreamEvents).where(eq(chatStreamEvents.streamId, testStreamId));
    await db.delete(chatMessages).where(eq(chatMessages.id, testMessageId));
    await db.delete(chatSessions).where(eq(chatSessions.id, testSessionId));
    await cleanupAuthData();
  });

  describe('GET /api/v1/streams/events/:streamId', () => {
    it('should return stream events for a valid streamId', async () => {
      const response = await authenticatedRequest(
        app,
        'GET',
        `/api/v1/streams/events/${testStreamId}`,
        user.sessionToken!
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.streamId).toBe(testStreamId);
      expect(data.events).toBeDefined();
      expect(Array.isArray(data.events)).toBe(true);
      expect(data.events.length).toBe(3);
      
      // Vérifier l'ordre séquentiel
      expect(data.events[0].sequence).toBe(1);
      expect(data.events[1].sequence).toBe(2);
      expect(data.events[2].sequence).toBe(3);
      
      // Vérifier les types d'événements
      expect(data.events[0].eventType).toBe('content_delta');
      expect(data.events[1].eventType).toBe('content_delta');
      expect(data.events[2].eventType).toBe('done');
    });

    it('should respect limit parameter', async () => {
      const response = await authenticatedRequest(
        app,
        'GET',
        `/api/v1/streams/events/${testStreamId}?limit=2`,
        user.sessionToken!
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.events.length).toBe(2);
      expect(data.events[0].sequence).toBe(1);
      expect(data.events[1].sequence).toBe(2);
    });

    it('should respect sinceSequence parameter', async () => {
      const response = await authenticatedRequest(
        app,
        'GET',
        `/api/v1/streams/events/${testStreamId}?sinceSequence=2`,
        user.sessionToken!
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      // sinceSequence=2 devrait retourner seulement les événements avec sequence > 2
      expect(data.events.length).toBe(1);
      expect(data.events[0].sequence).toBe(3);
    });

    it('should return empty array for non-existent streamId', async () => {
      const nonExistentStreamId = `non_existent_${createTestId()}`;
      const response = await authenticatedRequest(
        app,
        'GET',
        `/api/v1/streams/events/${nonExistentStreamId}`,
        user.sessionToken!
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.streamId).toBe(nonExistentStreamId);
      expect(data.events).toEqual([]);
    });

    it('should return 401 without authentication', async () => {
      const response = await authenticatedRequest(
        app,
        'GET',
        `/api/v1/streams/events/${testStreamId}`,
        null // Pas de token
      );

      expect(response.status).toBe(401);
    });

    it('should handle events with tool_call types', async () => {
      // Ajouter un événement tool_call
      await writeStreamEvent(testStreamId, 'tool_call_start', { 
        tool_call_id: 'test_tool_1', 
        name: 'read_usecase' 
      }, 4, testMessageId);
      
      await writeStreamEvent(testStreamId, 'tool_call_result', { 
        tool_call_id: 'test_tool_1', 
        result: { status: 'success', data: {} } 
      }, 5, testMessageId);

      const response = await authenticatedRequest(
        app,
        'GET',
        `/api/v1/streams/events/${testStreamId}`,
        user.sessionToken!
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.events.length).toBe(5);
      
      // Vérifier les événements tool_call
      const toolCallStart = data.events.find((e: any) => e.eventType === 'tool_call_start');
      expect(toolCallStart).toBeDefined();
      expect(toolCallStart.data.tool_call_id).toBe('test_tool_1');
      expect(toolCallStart.data.name).toBe('read_usecase');
      
      const toolCallResult = data.events.find((e: any) => e.eventType === 'tool_call_result');
      expect(toolCallResult).toBeDefined();
      expect(toolCallResult.data.tool_call_id).toBe('test_tool_1');
    });

    it('should handle reasoning_delta events', async () => {
      // Ajouter un événement reasoning
      await writeStreamEvent(testStreamId, 'reasoning_delta', { 
        delta: 'Thinking about the problem...' 
      }, 6, testMessageId);

      const response = await authenticatedRequest(
        app,
        'GET',
        `/api/v1/streams/events/${testStreamId}`,
        user.sessionToken!
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      const reasoningEvent = data.events.find((e: any) => e.eventType === 'reasoning_delta');
      expect(reasoningEvent).toBeDefined();
      expect(reasoningEvent.data.delta).toBe('Thinking about the problem...');
    });

    it('should handle error events', async () => {
      // Ajouter un événement error
      await writeStreamEvent(testStreamId, 'error', { 
        message: 'Test error message' 
      }, 7, testMessageId);

      const response = await authenticatedRequest(
        app,
        'GET',
        `/api/v1/streams/events/${testStreamId}`,
        user.sessionToken!
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      const errorEvent = data.events.find((e: any) => e.eventType === 'error');
      expect(errorEvent).toBeDefined();
      expect(errorEvent.data.message).toBe('Test error message');
    });
  });
});

