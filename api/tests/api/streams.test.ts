import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { app } from '../../src/app';
import { createTestId } from '../utils/test-helpers';
import { 
  createAuthenticatedUser, 
  authenticatedRequest, 
  cleanupAuthData 
} from '../utils/auth-helper';
import { db } from '../../src/db/client';
import { organizations, chatStreamEvents, chatMessages, chatSessions, users, workspaces } from '../../src/db/schema';
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
    await db.delete(chatStreamEvents).where(eq(chatStreamEvents.streamId, testMessageId));
    await db.delete(chatMessages).where(eq(chatMessages.id, testMessageId));
    await db.delete(chatSessions).where(eq(chatSessions.id, testSessionId));
    await cleanupAuthData();
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

      const orgRes = await authenticatedRequest(app, 'POST', '/api/v1/organizations', u.sessionToken!, {
        name: `SSE Tenant ${suffix}`,
        industry: 'Test',
      });
      expect(orgRes.status).toBe(201);
      const org = await orgRes.json();

      const userEvents = await collectFor(userReader, 1500);
      const adminEvents = await collectFor(adminReader, 1500);

      await userReader.cancel();
      await adminReader.cancel();

      const userOrgUpdates = userEvents.filter((e) => e.event === 'organization_update');
      expect(userOrgUpdates.length).toBeGreaterThan(0);
      const userSawOrg = userOrgUpdates.some((e) => e.data?.organizationId === org.id);
      expect(userSawOrg).toBe(true);

      const adminOrgUpdates = adminEvents.filter((e) => e.event === 'organization_update');
      const adminSawOrg = adminOrgUpdates.some((e) => e.data?.organizationId === org.id);
      expect(adminSawOrg).toBe(false);

      // Cleanup inserted org (avoid cross-test bleed)
      await db.delete(organizations).where(eq(organizations.id, org.id));
    });

    it('replays only unseen stream events when an explicit cursor is provided', async () => {
      const replayStreamId = testMessageId;
      await writeStreamEvent(replayStreamId, 'content_delta', { delta: 'Part A' }, 1, testMessageId);
      await writeStreamEvent(replayStreamId, 'content_delta', { delta: 'Part B' }, 2, testMessageId);
      await writeStreamEvent(replayStreamId, 'done', {}, 3, testMessageId);

      const cursor = Buffer.from(
        JSON.stringify({
          [replayStreamId]: 1,
        }),
      ).toString('base64url');

      const reader = await openSse(
        user.sessionToken!,
        `/api/v1/streams/sse?streamIds=${encodeURIComponent(replayStreamId)}&cursor=${encodeURIComponent(cursor)}`,
      );

      const events = await collectFor(reader, 500);
      await reader.cancel();

      const replayed = events
        .filter((event) => event.event === 'content_delta' || event.event === 'done')
        .map((event) => ({
          event: event.event,
          sequence: event.data?.sequence,
        }));

      expect(replayed).toEqual([
        { event: 'content_delta', sequence: 2 },
        { event: 'done', sequence: 3 },
      ]);
    });
  });
});
