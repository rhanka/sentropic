import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { app } from '../../src/app';
import { db } from '../../src/db/client';
import { jobQueue } from '../../src/db/schema';
import { queueManager } from '../../src/services/queue-manager';
import { writeStreamEvent } from '../../src/services/stream-service';
import {
  authenticatedRequest,
  cleanupAuthData,
  createAuthenticatedUser,
} from '../utils/auth-helper';
import { inArray } from 'drizzle-orm';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function collectSseEvents(sessionToken: string, path: string, ms = 500): Promise<Array<{ event?: string; data?: any }>> {
  const response = await app.request(path, {
    headers: { cookie: `session=${sessionToken}` },
  });
  expect(response.status).toBe(200);
  expect(response.body).toBeTruthy();

  const reader = (response.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  const output: Array<{ event?: string; data?: any }> = [];
  let buffer = '';
  const end = Date.now() + ms;

  try {
    while (Date.now() < end) {
      const result = await Promise.race([reader.read(), sleep(end - Date.now())]);
      if (!result || typeof (result as any).done !== 'boolean') break;
      const read = result as ReadableStreamReadResult<Uint8Array>;
      if (read.done) break;

      buffer += decoder.decode(read.value, { stream: true });
      const chunks = buffer.split('\n\n');
      buffer = chunks.pop() ?? '';

      for (const chunk of chunks) {
        const event = chunk.match(/^event:\s*(.+)$/m)?.[1]?.trim();
        const dataText = chunk.match(/^data:\s*(.+)$/m)?.[1]?.trim();
        output.push({ event, data: dataText ? JSON.parse(dataText) : undefined });
      }
    }
  } finally {
    await reader.cancel();
  }

  return output;
}

describe('chat-server mounted api contract', () => {
  let user: Awaited<ReturnType<typeof createAuthenticatedUser>>;
  let processJobsSpy: ReturnType<typeof vi.spyOn>;
  let createdJobIds: string[];

  beforeEach(async () => {
    createdJobIds = [];
    processJobsSpy = vi.spyOn(queueManager, 'processJobs').mockResolvedValue(undefined);
    user = await createAuthenticatedUser('editor');
  });

  afterEach(async () => {
    if (createdJobIds.length > 0) {
      await db.delete(jobQueue).where(inArray(jobQueue.id, createdJobIds));
    }
    await cleanupAuthData();
    processJobsSpy.mockRestore();
  });

  it('rejects unsupported future wire-version negotiation on mounted chat routes', async () => {
    const response = await authenticatedRequest(
      app,
      'POST',
      '/api/v1/chat/messages',
      user.sessionToken!,
      { content: 'Versioned future header should be rejected' },
      { 'Sec-Sentropic-Wire-Version': '2026-01-draft' },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'Sec-Sentropic-Wire-Version is not supported',
    });
  });

  it('routes turn-control endpoints through the mounted chat-server middleware', async () => {
    const createdResponse = await authenticatedRequest(
      app,
      'POST',
      '/api/v1/chat/messages',
      user.sessionToken!,
      { content: 'Control route mount check' },
    );
    expect(createdResponse.status).toBe(200);
    const created = await createdResponse.json();
    createdJobIds.push(String(created.jobId));

    const response = await authenticatedRequest(
      app,
      'POST',
      `/api/v1/chat/messages/${created.assistantMessageId}/stop`,
      user.sessionToken!,
      {},
      { 'Sec-Sentropic-Wire-Version': '2026-01-draft' },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'Sec-Sentropic-Wire-Version is not supported',
    });
  });

  it('serves POST, SSE replay, and bootstrap through the mounted chat-server adapters', async () => {
    const createdResponse = await authenticatedRequest(
      app,
      'POST',
      '/api/v1/chat/messages',
      user.sessionToken!,
      {
        content: 'Mounted chat-server round-trip check',
        contexts: [{ contextType: 'organization', contextId: 'org_mount' }],
      },
    );
    expect(createdResponse.status).toBe(200);
    const created = await createdResponse.json();
    createdJobIds.push(String(created.jobId));

    expect(created).toEqual({
      sessionId: expect.any(String),
      userMessageId: expect.any(String),
      assistantMessageId: expect.any(String),
      streamId: created.assistantMessageId,
      jobId: expect.any(String),
    });

    await writeStreamEvent(
      created.assistantMessageId,
      'content_delta',
      { delta: 'Mounted' },
      1,
      created.assistantMessageId,
    );
    await writeStreamEvent(
      created.assistantMessageId,
      'done',
      {},
      2,
      created.assistantMessageId,
    );

    const events = await collectSseEvents(
      user.sessionToken!,
      `/api/v1/streams/sse?streamIds=${encodeURIComponent(created.assistantMessageId)}`,
    );

    expect(
      events
        .filter((event) => event.event === 'content_delta' || event.event === 'done')
        .map((event) => ({
          event: event.event,
          streamId: event.data?.streamId,
          sequence: event.data?.sequence,
          data: event.data?.data,
        })),
    ).toEqual([
      {
        event: 'content_delta',
        streamId: created.assistantMessageId,
        sequence: 1,
        data: { delta: 'Mounted' },
      },
      {
        event: 'done',
        streamId: created.assistantMessageId,
        sequence: 2,
        data: {},
      },
    ]);

    const bootstrapResponse = await authenticatedRequest(
      app,
      'GET',
      `/api/v1/chat/sessions/${created.sessionId}/bootstrap`,
      user.sessionToken!,
    );
    expect(bootstrapResponse.status).toBe(200);
    const bootstrap = await bootstrapResponse.json();

    expect(bootstrap.sessionId).toBe(created.sessionId);
    expect(bootstrap.messages).toEqual([
      expect.objectContaining({
        id: created.userMessageId,
        role: 'user',
        content: 'Mounted chat-server round-trip check',
        contexts: [{ contextType: 'organization', contextId: 'org_mount' }],
      }),
      expect.objectContaining({
        id: created.assistantMessageId,
        role: 'assistant',
      }),
    ]);
    expect(bootstrap.assistantDetailsByMessageId[created.assistantMessageId]).toEqual([
      expect.objectContaining({ eventType: 'content_delta', sequence: 1 }),
      expect.objectContaining({ eventType: 'done', sequence: 2 }),
    ]);

    const sessions = await authenticatedRequest(
      app,
      'GET',
      '/api/v1/chat/sessions',
      user.sessionToken!,
    );
    expect(await sessions.json()).toEqual({
      sessions: expect.arrayContaining([
        expect.objectContaining({ id: created.sessionId }),
      ]),
    });

    const misplacedStream = await authenticatedRequest(
      app,
      'GET',
      `/api/v1/chat/streams/sse?streamIds=${created.assistantMessageId}`,
      user.sessionToken!,
    );
    expect(misplacedStream.status).toBe(404);
  });
});
