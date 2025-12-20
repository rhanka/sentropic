import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  generateStreamId,
  writeStreamEvent,
  getNextSequence,
  readStreamEvents,
} from '../../src/services/stream-service';
import { db } from '../../src/db/client';
import { chatStreamEvents, chatMessages, chatSessions, users } from '../../src/db/schema';
import { eq } from 'drizzle-orm';
import { createId } from '../../src/utils/id';

describe('Stream Service', () => {
  let testStreamId: string;
  let testUserId: string;
  let testSessionId: string;
  let testMessageId: string | null;

  beforeEach(async () => {
    testStreamId = `test_stream_${createId()}`;
    testMessageId = null;
    
    // Créer un user, une session pour les tests qui nécessitent messageId
    testUserId = createId();
    await db.insert(users).values({
      id: testUserId,
      email: `test-${testUserId}@example.com`,
      displayName: 'Test User',
      role: 'editor',
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date()
    });
    
    testSessionId = createId();
    await db.insert(chatSessions).values({
      id: testSessionId,
      userId: testUserId,
      primaryContextType: 'usecase',
      primaryContextId: createId(),
      createdAt: new Date(),
      updatedAt: new Date()
    });
  });

  afterEach(async () => {
    // Cleanup: supprimer tous les événements de test
    await db.delete(chatStreamEvents).where(eq(chatStreamEvents.streamId, testStreamId));
    // Cleanup messages et sessions créés pour les tests
    if (testMessageId) {
      await db.delete(chatMessages).where(eq(chatMessages.id, testMessageId));
    }
    await db.delete(chatSessions).where(eq(chatSessions.id, testSessionId));
    await db.delete(users).where(eq(users.id, testUserId));
  });

  describe('generateStreamId', () => {
    it('should generate stream_id from messageId', () => {
      const messageId = 'msg_123';
      const streamId = generateStreamId(undefined, undefined, messageId);
      expect(streamId).toBe(messageId);
    });

    it('should generate deterministic stream_id from jobId', () => {
      const jobId = 'job_456';
      const streamId1 = generateStreamId(undefined, jobId);
      const streamId2 = generateStreamId(undefined, jobId);
      expect(streamId1).toBe(`job_${jobId}`);
      expect(streamId2).toBe(`job_${jobId}`);
      expect(streamId1).toBe(streamId2);
    });

    it('should generate stream_id from promptId with timestamp', () => {
      const promptId = 'prompt_789';
      const streamId = generateStreamId(promptId);
      expect(streamId).toMatch(/^prompt_prompt_789_\d+$/);
    });

    it('should generate unique stream_id when no parameters provided', () => {
      const streamId1 = generateStreamId();
      const streamId2 = generateStreamId();
      expect(streamId1).toMatch(/^stream_/);
      expect(streamId2).toMatch(/^stream_/);
      expect(streamId1).not.toBe(streamId2);
    });

    it('should prioritize messageId over jobId and promptId', () => {
      const messageId = 'msg_999';
      const jobId = 'job_888';
      const promptId = 'prompt_777';
      const streamId = generateStreamId(promptId, jobId, messageId);
      expect(streamId).toBe(messageId);
    });
  });

  describe('writeStreamEvent', () => {
    it('should write event to database', async () => {
      await writeStreamEvent(testStreamId, 'content_delta', { delta: 'Hello' }, 1);

      const events = await db
        .select()
        .from(chatStreamEvents)
        .where(eq(chatStreamEvents.streamId, testStreamId));

      expect(events.length).toBe(1);
      expect(events[0].eventType).toBe('content_delta');
      expect(events[0].sequence).toBe(1);
      expect(events[0].data).toEqual({ delta: 'Hello' });
      expect(events[0].messageId).toBeNull();
    });

    it('should write event with messageId', async () => {
      // Créer un message valide pour satisfaire la contrainte FK
      const messageId = createId();
      await db.insert(chatMessages).values({
        id: messageId,
        sessionId: testSessionId,
        role: 'assistant',
        content: 'Test message',
        sequence: 1,
        createdAt: new Date()
      });
      
      await writeStreamEvent(testStreamId, 'reasoning_delta', { delta: 'Thinking...' }, 1, messageId);

      const events = await db
        .select()
        .from(chatStreamEvents)
        .where(eq(chatStreamEvents.streamId, testStreamId));

      expect(events.length).toBe(1);
      expect(events[0].messageId).toBe(messageId);
      
      // Cleanup message
      await db.delete(chatMessages).where(eq(chatMessages.id, messageId));
    });

    it('should write multiple events with different sequences', async () => {
      await writeStreamEvent(testStreamId, 'reasoning_delta', { delta: 'Step 1' }, 1);
      await writeStreamEvent(testStreamId, 'reasoning_delta', { delta: 'Step 2' }, 2);
      await writeStreamEvent(testStreamId, 'content_delta', { delta: 'Result' }, 3);

      const events = await db
        .select()
        .from(chatStreamEvents)
        .where(eq(chatStreamEvents.streamId, testStreamId))
        .orderBy(chatStreamEvents.sequence);

      expect(events.length).toBe(3);
      expect(events[0].sequence).toBe(1);
      expect(events[1].sequence).toBe(2);
      expect(events[2].sequence).toBe(3);
      expect(events[0].eventType).toBe('reasoning_delta');
      expect(events[2].eventType).toBe('content_delta');
    });

    it('should handle complex data objects', async () => {
      const complexData = {
        tool_call_id: 'call_123',
        name: 'update_usecase_field',
        args: { useCaseId: 'uc_1', updates: [{ path: 'data.name', value: 'New Name' }] }
      };

      await writeStreamEvent(testStreamId, 'tool_call_start', complexData, 1);

      const events = await db
        .select()
        .from(chatStreamEvents)
        .where(eq(chatStreamEvents.streamId, testStreamId));

      expect(events[0].data).toEqual(complexData);
    });

    // Note: Le test du NOTIFY PostgreSQL est complexe à tester unitairement
    // car il nécessite une connexion active et un listener. On vérifie juste
    // que la fonction s'exécute sans erreur.
    it('should execute without error (NOTIFY handled by PostgreSQL)', async () => {
      await expect(
        writeStreamEvent(testStreamId, 'status', { state: 'started' }, 1)
      ).resolves.not.toThrow();
    });
  });

  describe('getNextSequence', () => {
    it('should return 1 for new stream_id', async () => {
      const sequence = await getNextSequence(testStreamId);
      expect(sequence).toBe(1);
    });

    it('should return next sequence after events exist', async () => {
      await writeStreamEvent(testStreamId, 'content_delta', { delta: 'First' }, 1);
      await writeStreamEvent(testStreamId, 'content_delta', { delta: 'Second' }, 2);

      const nextSequence = await getNextSequence(testStreamId);
      expect(nextSequence).toBe(3);
    });

    it('should handle multiple streams independently', async () => {
      const streamId1 = `${testStreamId}_1`;
      const streamId2 = `${testStreamId}_2`;

      await writeStreamEvent(streamId1, 'content_delta', { delta: 'A' }, 1);
      await writeStreamEvent(streamId1, 'content_delta', { delta: 'B' }, 2);
      await writeStreamEvent(streamId2, 'content_delta', { delta: 'X' }, 1);

      const seq1 = await getNextSequence(streamId1);
      const seq2 = await getNextSequence(streamId2);

      expect(seq1).toBe(3);
      expect(seq2).toBe(2);

      // Cleanup
      await db.delete(chatStreamEvents).where(eq(chatStreamEvents.streamId, streamId1));
      await db.delete(chatStreamEvents).where(eq(chatStreamEvents.streamId, streamId2));
    });

    it('should handle gaps in sequences correctly', async () => {
      // Créer des événements avec des séquences non consécutives (cas théorique)
      await writeStreamEvent(testStreamId, 'content_delta', { delta: 'First' }, 1);
      await writeStreamEvent(testStreamId, 'content_delta', { delta: 'Third' }, 3); // Gap: pas de 2

      const nextSequence = await getNextSequence(testStreamId);
      // Devrait retourner max(1, 3) + 1 = 4
      expect(nextSequence).toBe(4);
    });
  });

  describe('readStreamEvents', () => {
    beforeEach(async () => {
      // Créer quelques événements de test
      await writeStreamEvent(testStreamId, 'reasoning_delta', { delta: 'R1' }, 1);
      await writeStreamEvent(testStreamId, 'reasoning_delta', { delta: 'R2' }, 2);
      await writeStreamEvent(testStreamId, 'content_delta', { delta: 'C1' }, 3);
      await writeStreamEvent(testStreamId, 'content_delta', { delta: 'C2' }, 4);
      await writeStreamEvent(testStreamId, 'done', {}, 5);
    });

    it('should read all events for a stream_id', async () => {
      const events = await readStreamEvents(testStreamId);

      expect(events.length).toBe(5);
      expect(events[0].sequence).toBe(1);
      expect(events[4].sequence).toBe(5);
      expect(events[0].eventType).toBe('reasoning_delta');
      expect(events[4].eventType).toBe('done');
    });

    it('should read events since a sequence', async () => {
      const events = await readStreamEvents(testStreamId, 3);

      expect(events.length).toBe(2); // sequences 4, 5 (3 est exclu car > 3)
      expect(events[0].sequence).toBe(4);
      expect(events[1].sequence).toBe(5);
    });

    it('should limit number of events returned', async () => {
      const events = await readStreamEvents(testStreamId, undefined, 2);

      expect(events.length).toBe(2);
      expect(events[0].sequence).toBe(1);
      expect(events[1].sequence).toBe(2);
    });

    it('should combine sinceSequence and limit', async () => {
      const events = await readStreamEvents(testStreamId, 2, 2);

      expect(events.length).toBe(2);
      expect(events[0].sequence).toBe(3);
      expect(events[1].sequence).toBe(4);
    });

    it('should return empty array for non-existent stream_id', async () => {
      const events = await readStreamEvents('non_existent_stream');
      expect(events.length).toBe(0);
    });

    it('should return events ordered by sequence', async () => {
      // Créer des événements dans un ordre non séquentiel
      const scrambledStreamId = `${testStreamId}_scrambled`;
      await writeStreamEvent(scrambledStreamId, 'content_delta', { delta: 'Third' }, 3);
      await writeStreamEvent(scrambledStreamId, 'content_delta', { delta: 'First' }, 1);
      await writeStreamEvent(scrambledStreamId, 'content_delta', { delta: 'Second' }, 2);

      const events = await readStreamEvents(scrambledStreamId);

      expect(events.length).toBe(3);
      expect(events[0].sequence).toBe(1);
      expect(events[1].sequence).toBe(2);
      expect(events[2].sequence).toBe(3);
      expect(events[0].data).toEqual({ delta: 'First' });
      expect(events[2].data).toEqual({ delta: 'Third' });

      // Cleanup
      await db.delete(chatStreamEvents).where(eq(chatStreamEvents.streamId, scrambledStreamId));
    });

    it('should include all event properties', async () => {
      // Créer un message valide pour satisfaire la contrainte FK
      const messageId = createId();
      await db.insert(chatMessages).values({
        id: messageId,
        sessionId: testSessionId,
        role: 'assistant',
        content: 'Test message',
        sequence: 1,
        createdAt: new Date()
      });
      
      await writeStreamEvent(testStreamId, 'tool_call_result', { result: 'ok' }, 10, messageId);

      const events = await readStreamEvents(testStreamId, 9);

      expect(events.length).toBeGreaterThan(0);
      const event = events.find(e => e.sequence === 10);
      expect(event).toBeDefined();
      expect(event?.id).toBeDefined();
      expect(event?.messageId).toBe(messageId);
      expect(event?.streamId).toBe(testStreamId);
      expect(event?.eventType).toBe('tool_call_result');
      expect(event?.data).toEqual({ result: 'ok' });
      expect(event?.sequence).toBe(10);
      expect(event?.createdAt).toBeInstanceOf(Date);
      
      // Cleanup message
      await db.delete(chatMessages).where(eq(chatMessages.id, messageId));
    });
  });
});

