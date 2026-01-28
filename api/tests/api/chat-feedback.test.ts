import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { app } from '../../src/app';
import { createAuthenticatedUser, authenticatedRequest, cleanupAuthData } from '../utils/auth-helper';
import { queueManager } from '../../src/services/queue-manager';

describe('Chat feedback API', () => {
  let user: any;
  let processJobsSpy: any;

  beforeEach(async () => {
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

  it('sets, updates, and clears feedback on assistant messages', async () => {
    const create = await authenticatedRequest(app, 'POST', '/api/v1/chat/messages', user.sessionToken!, {
      content: 'Feedback target'
    });
    expect(create.status).toBe(200);
    const created = await create.json();

    const up = await authenticatedRequest(
      app,
      'POST',
      `/api/v1/chat/messages/${created.assistantMessageId}/feedback`,
      user.sessionToken!,
      { vote: 'up' }
    );
    expect(up.status).toBe(200);
    const upData = await up.json();
    expect(upData.vote).toBe(1);

    const down = await authenticatedRequest(
      app,
      'POST',
      `/api/v1/chat/messages/${created.assistantMessageId}/feedback`,
      user.sessionToken!,
      { vote: 'down' }
    );
    expect(down.status).toBe(200);
    const downData = await down.json();
    expect(downData.vote).toBe(-1);

    const clear = await authenticatedRequest(
      app,
      'POST',
      `/api/v1/chat/messages/${created.assistantMessageId}/feedback`,
      user.sessionToken!,
      { vote: 'clear' }
    );
    expect(clear.status).toBe(200);
    const clearData = await clear.json();
    expect(clearData.vote).toBe(null);

    const list = await authenticatedRequest(
      app,
      'GET',
      `/api/v1/chat/sessions/${created.sessionId}/messages`,
      user.sessionToken!
    );
    expect(list.status).toBe(200);
    const payload = await list.json();
    const assistant = (payload.messages || []).find((m: any) => m.id === created.assistantMessageId);
    expect(assistant).toBeTruthy();
    expect(assistant.feedbackVote).toBe(null);
  });

  it('rejects feedback on user messages', async () => {
    const create = await authenticatedRequest(app, 'POST', '/api/v1/chat/messages', user.sessionToken!, {
      content: 'User feedback not allowed'
    });
    expect(create.status).toBe(200);
    const created = await create.json();

    const res = await authenticatedRequest(
      app,
      'POST',
      `/api/v1/chat/messages/${created.userMessageId}/feedback`,
      user.sessionToken!,
      { vote: 'up' }
    );
    expect(res.status).toBe(400);
  });
});
