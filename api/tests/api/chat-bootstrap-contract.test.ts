import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { eq } from 'drizzle-orm';

import { app } from '../../src/app';
import { db } from '../../src/db/client';
import { chatMessages, contextDocuments } from '../../src/db/schema';
import { queueManager } from '../../src/services/queue-manager';
import { writeStreamEvent } from '../../src/services/stream-service';
import {
  authenticatedRequest,
  cleanupAuthData,
  createAuthenticatedUser,
} from '../utils/auth-helper';

describe('chat session bootstrap contract', () => {
  let user: Awaited<ReturnType<typeof createAuthenticatedUser>>;
  let processJobsSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    processJobsSpy = vi
      .spyOn(queueManager, 'processJobs')
      .mockResolvedValue(undefined);
    user = await createAuthenticatedUser('editor');
  });

  afterEach(async () => {
    await cleanupAuthData();
    processJobsSpy.mockRestore();
  });

  afterAll(() => {
    vi.clearAllMocks();
  });

  it('returns one coherent snapshot for chat session reload', async () => {
    const create = await authenticatedRequest(
      app,
      'POST',
      '/api/v1/chat/messages',
      user.sessionToken!,
      {
        content: 'Bootstrap contract message',
      },
    );
    expect(create.status).toBe(200);
    const payload = await create.json();
    const sessionId = String(payload.sessionId);
    const assistantMessageId = String(payload.assistantMessageId);

    await db
      .update(chatMessages)
      .set({
        content: 'Bootstrap final response',
        model: 'gpt-5.4',
      })
      .where(eq(chatMessages.id, assistantMessageId));

    await writeStreamEvent(
      assistantMessageId,
      'status',
      { state: 'started' },
      1,
      assistantMessageId,
    );
    await writeStreamEvent(
      assistantMessageId,
      'reasoning_delta',
      { delta: 'Thinking through the answer.' },
      2,
      assistantMessageId,
    );
    await writeStreamEvent(
      assistantMessageId,
      'tool_call_start',
      { id: 'call_bootstrap', name: 'history_analyze' },
      3,
      assistantMessageId,
    );
    await writeStreamEvent(
      assistantMessageId,
      'tool_call_result',
      { id: 'call_bootstrap', result: { ok: true } },
      4,
      assistantMessageId,
    );
    await writeStreamEvent(
      assistantMessageId,
      'content_delta',
      { delta: 'Bootstrap final response' },
      5,
      assistantMessageId,
    );
    await writeStreamEvent(
      assistantMessageId,
      'done',
      {},
      6,
      assistantMessageId,
    );

    const checkpointRes = await authenticatedRequest(
      app,
      'POST',
      `/api/v1/chat/sessions/${sessionId}/checkpoints`,
      user.sessionToken!,
      { title: 'Bootstrap checkpoint' },
    );
    expect(checkpointRes.status).toBe(200);

    await db.insert(contextDocuments).values({
      id: crypto.randomUUID(),
      workspaceId: String(user.workspaceId),
      contextType: 'chat_session',
      contextId: sessionId,
      filename: 'bootstrap-brief.md',
      mimeType: 'text/markdown',
      sizeBytes: 128,
      storageKey: `tests/${sessionId}/bootstrap-brief.md`,
      status: 'ready',
      data: {
        summary: 'Bootstrap summary',
        summaryLang: 'fr',
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const bootstrap = await authenticatedRequest(
      app,
      'GET',
      `/api/v1/chat/sessions/${sessionId}/bootstrap`,
      user.sessionToken!,
    );
    expect(bootstrap.status).toBe(200);

    const body = await bootstrap.json();
    expect(Array.isArray(body.messages)).toBe(true);
    expect(Array.isArray(body.checkpoints)).toBe(true);
    expect(Array.isArray(body.documents)).toBe(true);
    expect(body.assistantDetailsByMessageId).toBeTruthy();
    expect(body.assistantDetailsByMessageId[assistantMessageId]).toBeTruthy();
    expect(body.assistantDetailsByMessageId[assistantMessageId].length).toBe(6);
    expect(body.checkpoints[0]?.title).toBe('Bootstrap checkpoint');
    expect(body.documents[0]?.filename).toBe('bootstrap-brief.md');
    expect(body.documents[0]?.summary).toBe('Bootstrap summary');
  });
});
