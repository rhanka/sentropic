import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { app } from '../../src/app';
import { createTestId } from '../utils/test-helpers';
import { 
  createAuthenticatedUser, 
  authenticatedRequest, 
  cleanupAuthData 
} from '../utils/auth-helper';
import { db } from '../../src/db/client';
import { companies, chatStreamEvents, chatMessages, chatSessions, users, workspaces } from '../../src/db/schema';
import { eq } from 'drizzle-orm';
import { writeStreamEvent, getNextSequence } from '../../src/services/stream-service';
import { ensureWorkspaceForUser } from '../../src/services/workspace-service';

type SseEvent = { event?: string; data?: any; raw?: string };

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseSse(buffer: string): { events: SseEvent[]; rest: string } {
  const parts = buffer.split('\n\n');
  const complete = parts.slice(0, -1);
  const rest = parts[parts.length - 1] ?? '';
  const events: SseEvent[] = [];
  for (const chunk of complete) {
    const lines = chunk.split('\n').filter(Boolean);
    let event: string | undefined;
    let dataLine: string | undefined;
    for (const line of lines) {
      if (line.startsWith('event:')) event = line.slice('event:'.length).trim();
      if (line.startsWith('data:')) dataLine = line.slice('data:'.length).trim();
    }
    let data: any = undefined;
    if (dataLine) {
      try {
        data = JSON.parse(dataLine);
      } catch {
        data = dataLine;
      }
    }
    events.push({ event, data, raw: chunk });
  }
  return { events, rest };
}

async function openSse(sessionToken: string, path: string) {
  const res = await app.request(path, {
    headers: { cookie: `session=${sessionToken}` },
  });
  expect(res.status).toBe(200);
  expect(res.body).toBeTruthy();
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  // Wait for ": connected" comment to ensure LISTEN is set.
  await Promise.race([reader.read(), sleep(500)]);
  return reader;
}

async function collectFor(reader: ReadableStreamDefaultReader<Uint8Array>, ms: number): Promise<SseEvent[]> {
  const end = Date.now() + ms;
  const decoder = new TextDecoder();
  let buf = '';
  const out: SseEvent[] = [];
  while (Date.now() < end) {
    const remaining = end - Date.now();
    const res = await Promise.race([reader.read(), sleep(remaining)]);
    if (!res || typeof (res as any).done !== 'boolean') break;
    const r = res as ReadableStreamReadResult<Uint8Array>;
    if (r.done) break;
    buf += decoder.decode(r.value, { stream: true });
    const parsed = parseSse(buf);
    buf = parsed.rest;
    out.push(...parsed.events);
  }
  return out;
}

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
      expect(['read_usecase', 'usecase_get']).toContain(toolCallStart.data.name);
      
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

  describe('GET /api/v1/streams/sse (tenancy)', () => {
    it('should not leak company updates across workspaces (admin_app stays isolated by default)', async () => {
      const suffix = createTestId();
      const admin = await createAuthenticatedUser('admin_app', `admin-sse-${suffix}@example.com`);
      const u = await createAuthenticatedUser('editor', `user-sse-${suffix}@example.com`);

      // Create workspaces (createAuthenticatedUser does not go through auth middleware).
      await ensureWorkspaceForUser(admin.id);
      await ensureWorkspaceForUser(u.id);

      // Resolve user's workspace id
      const [ws] = await db.select().from(workspaces).where(eq(workspaces.ownerUserId, u.id)).limit(1);
      expect(ws?.id).toBeTruthy();

      const adminReader = await openSse(admin.sessionToken!, '/api/v1/streams/sse');
      const userReader = await openSse(u.sessionToken!, '/api/v1/streams/sse');

      const companyRes = await authenticatedRequest(app, 'POST', '/api/v1/companies', u.sessionToken!, {
        name: `SSE Tenant ${suffix}`,
        industry: 'Test',
      });
      expect(companyRes.status).toBe(201);
      const company = await companyRes.json();

      const userEvents = await collectFor(userReader, 1500);
      const adminEvents = await collectFor(adminReader, 1500);

      await userReader.cancel();
      await adminReader.cancel();

      const userCompanyUpdates = userEvents.filter((e) => e.event === 'company_update');
      expect(userCompanyUpdates.length).toBeGreaterThan(0);
      const userSawCompany = userCompanyUpdates.some((e) => e.data?.companyId === company.id);
      expect(userSawCompany).toBe(true);

      const adminCompanyUpdates = adminEvents.filter((e) => e.event === 'company_update');
      const adminSawCompany = adminCompanyUpdates.some((e) => e.data?.companyId === company.id);
      expect(adminSawCompany).toBe(false);

      // Cleanup inserted company (avoid cross-test bleed)
      await db.delete(companies).where(eq(companies.id, company.id));
    });
  });
});

