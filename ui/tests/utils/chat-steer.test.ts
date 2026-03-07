import { describe, expect, it, vi } from 'vitest';
import {
  insertSteerMessageInTimeline,
  postChatSteer,
} from '../../src/lib/utils/chat-steer';

describe('chat steer utils', () => {
  it('posts steer payload to chat message endpoint and normalizes feedback', async () => {
    const apiPost = vi.fn(async () => ({
      assistantMessageId: 'msg_assistant_1',
      status: 'accepted',
      steer: {
        message: 'Refocus on acceptance criteria',
      },
    }));

    const feedback = await postChatSteer(
      apiPost,
      'msg_assistant_1',
      'Refocus on acceptance criteria',
    );

    expect(apiPost).toHaveBeenCalledTimes(1);
    expect(apiPost).toHaveBeenCalledWith(
      '/chat/messages/msg_assistant_1/steer',
      {
        message: 'Refocus on acceptance criteria',
      },
    );
    expect(feedback.assistantMessageId).toBe('msg_assistant_1');
    expect(feedback.status).toBe('accepted');
    expect(feedback.message).toBe('Refocus on acceptance criteria');
  });

  it('throws when assistant message id is missing', async () => {
    const apiPost = vi.fn(async () => ({}));

    await expect(
      postChatSteer(apiPost, '   ', 'Refocus'),
    ).rejects.toThrow('Missing assistant message id');
  });

  it('throws when steer message is missing', async () => {
    const apiPost = vi.fn(async () => ({}));

    await expect(
      postChatSteer(apiPost, 'msg_assistant_2', '   '),
    ).rejects.toThrow('Missing steer message');
  });

  it('inserts steer message just after active assistant message during optimistic rendering', () => {
    const timeline = [
      { id: 'user_1', role: 'user' },
      { id: 'assistant_1', role: 'assistant' },
    ];
    const steerMessage = { id: 'steer_1', role: 'user' };

    const next = insertSteerMessageInTimeline(
      timeline,
      steerMessage,
      'assistant_1',
    );

    expect(next.map((message) => message.id)).toEqual([
      'user_1',
      'assistant_1',
      'steer_1',
    ]);
  });

  it('appends steer message when active assistant message is unavailable', () => {
    const timeline = [
      { id: 'user_1', role: 'user' },
      { id: 'assistant_1', role: 'assistant' },
    ];
    const steerMessage = { id: 'steer_1', role: 'user' };

    const next = insertSteerMessageInTimeline(timeline, steerMessage, null);

    expect(next.map((message) => message.id)).toEqual([
      'user_1',
      'assistant_1',
      'steer_1',
    ]);
  });
});
