import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { app } from '../../src/app';
import { createAuthenticatedUser, authenticatedRequest, cleanupAuthData } from '../utils/auth-helper';
import { db } from '../../src/db/client';
import { chatMessages } from '../../src/db/schema';
import { eq } from 'drizzle-orm';
import { queueManager } from '../../src/services/queue-manager';

describe('Chat message actions API', () => {
  let editor: any;
  let viewer: any;
  let processJobsSpy: any;

  beforeEach(async () => {
    if (!processJobsSpy) {
      processJobsSpy = vi.spyOn(queueManager, 'processJobs').mockResolvedValue(undefined);
    }
    editor = await createAuthenticatedUser('editor');
    viewer = await createAuthenticatedUser('guest');
  });

  afterEach(async () => {
    await cleanupAuthData();
    await cleanupAuthData();
  });

  afterAll(async () => {
    try {
      processJobsSpy?.mockRestore?.();
    } catch {
      // ignore
    }
  });

  it('PATCH /chat/messages/:id edits user message content for editors', async () => {
    const create = await authenticatedRequest(app, 'POST', '/api/v1/chat/messages', editor.sessionToken!, {
      content: 'Original message',
    });
    expect(create.status).toBe(200);
    const created = await create.json();

    const res = await authenticatedRequest(
      app,
      'PATCH',
      `/api/v1/chat/messages/${created.userMessageId}`,
      editor.sessionToken!,
      { content: 'Updated message' }
    );
    expect(res.status).toBe(200);

    const [row] = await db.select().from(chatMessages).where(eq(chatMessages.id, created.userMessageId)).limit(1);
    expect(row?.content).toBe('Updated message');
  });

  it('PATCH /chat/messages/:id is forbidden for viewers', async () => {
    const create = await authenticatedRequest(app, 'POST', '/api/v1/chat/messages', viewer.sessionToken!, {
      content: 'Viewer message',
    });
    expect(create.status).toBe(200);
    const created = await create.json();

    const res = await authenticatedRequest(
      app,
      'PATCH',
      `/api/v1/chat/messages/${created.userMessageId}`,
      viewer.sessionToken!,
      { content: 'Should fail' }
    );
    expect(res.status).toBe(403);
  });

  it('POST /chat/messages/:id/retry retries a user message', async () => {
    const create = await authenticatedRequest(app, 'POST', '/api/v1/chat/messages', viewer.sessionToken!, {
      content: 'Retry me',
    });
    expect(create.status).toBe(200);
    const created = await create.json();

    const retry = await authenticatedRequest(
      app,
      'POST',
      `/api/v1/chat/messages/${created.userMessageId}/retry`,
      viewer.sessionToken!,
      { model: 'gemini-2.5-flash-lite' }
    );
    expect(retry.status).toBe(200);
    const retryData = await retry.json();
    expect(retryData.assistantMessageId).toBeTruthy();

    const rows = await db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.sessionId, retryData.sessionId));
    expect(rows.length).toBe(2);
    const assistant = rows.find((row) => row.role === 'assistant');
    expect(assistant?.model).toBe('gemini-2.5-flash-lite');
  });

  it('POST /chat/messages/:id/retry rejects assistant messages', async () => {
    const create = await authenticatedRequest(app, 'POST', '/api/v1/chat/messages', editor.sessionToken!, {
      content: 'Retry assistant',
    });
    expect(create.status).toBe(200);
    const created = await create.json();

    const retry = await authenticatedRequest(
      app,
      'POST',
      `/api/v1/chat/messages/${created.assistantMessageId}/retry`,
      editor.sessionToken!
    );
    expect(retry.status).toBe(400);
  });
});
