import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { app } from '../../src/app';
import { queueManager } from '../../src/services/queue-manager';
import {
  authenticatedRequest,
  cleanupAuthData,
  createAuthenticatedUser,
} from '../utils/auth-helper';

describe('chat checkpoint contract endpoints', () => {
  let user: Awaited<ReturnType<typeof createAuthenticatedUser>>;
  let processJobsSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    processJobsSpy = vi.spyOn(queueManager, 'processJobs').mockResolvedValue(undefined);
    user = await createAuthenticatedUser('editor');
  });

  afterEach(async () => {
    await cleanupAuthData();
    processJobsSpy.mockRestore();
  });

  afterAll(() => {
    vi.clearAllMocks();
  });

  it('creates, lists and restores checkpoints for a chat session', async () => {
    const firstMessage = await authenticatedRequest(
      app,
      'POST',
      '/api/v1/chat/messages',
      user.sessionToken!,
      {
        content: 'Checkpoint contract message #1',
      },
    );
    expect(firstMessage.status).toBe(200);
    const firstPayload = await firstMessage.json();
    const sessionId = String(firstPayload.sessionId);

    const createCheckpoint = await authenticatedRequest(
      app,
      'POST',
      `/api/v1/chat/sessions/${sessionId}/checkpoints`,
      user.sessionToken!,
      {
        title: 'Before second turn',
      },
    );
    expect(createCheckpoint.status).toBe(200);
    const checkpointPayload = await createCheckpoint.json();
    const checkpointId = String(checkpointPayload?.checkpoint?.id ?? '');
    expect(checkpointId.length).toBeGreaterThan(0);

    const secondMessage = await authenticatedRequest(
      app,
      'POST',
      '/api/v1/chat/messages',
      user.sessionToken!,
      {
        sessionId,
        content: 'Checkpoint contract message #2',
      },
    );
    expect(secondMessage.status).toBe(200);

    const listBeforeRestore = await authenticatedRequest(
      app,
      'GET',
      `/api/v1/chat/sessions/${sessionId}/checkpoints`,
      user.sessionToken!,
    );
    expect(listBeforeRestore.status).toBe(200);
    const listed = await listBeforeRestore.json();
    expect(Array.isArray(listed.checkpoints)).toBe(true);
    expect(listed.checkpoints.length).toBeGreaterThan(0);

    const restore = await authenticatedRequest(
      app,
      'POST',
      `/api/v1/chat/sessions/${sessionId}/checkpoints/${checkpointId}/restore`,
      user.sessionToken!,
      {},
    );
    expect(restore.status).toBe(200);
    const restored = await restore.json();
    expect(Number(restored.removedMessages)).toBeGreaterThan(0);

    const messagesAfterRestore = await authenticatedRequest(
      app,
      'GET',
      `/api/v1/chat/sessions/${sessionId}/messages`,
      user.sessionToken!,
    );
    expect(messagesAfterRestore.status).toBe(200);
    const messagePayload = await messagesAfterRestore.json();
    const sequences = (messagePayload.messages ?? []).map((message: any) =>
      Number(message.sequence),
    );
    expect(sequences).toEqual([1, 2]);
  });
});
