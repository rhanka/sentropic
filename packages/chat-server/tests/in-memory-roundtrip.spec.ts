import { describe, expect, it } from 'vitest';

import { createChatServer, createInMemoryChatServerDeps } from '../src/index';

type SseEvent = {
  event?: string;
  data?: any;
};

function parseSse(text: string): SseEvent[] {
  return text
    .split('\n\n')
    .filter((chunk) => chunk.trim().length > 0)
    .map((chunk) => {
      const eventLine = chunk
        .split('\n')
        .find((line) => line.startsWith('event:'));
      const dataLine = chunk
        .split('\n')
        .find((line) => line.startsWith('data:'));
      return {
        event: eventLine?.slice('event:'.length).trim(),
        data: dataLine ? JSON.parse(dataLine.slice('data:'.length).trim()) : undefined,
      };
    });
}

describe('chat-server in-memory roundtrip', () => {
  it('posts a message, replays stream events, and bootstraps the session', async () => {
    const app = createChatServer(
      createInMemoryChatServerDeps({ assistantReply: 'Hello from the deterministic adapter.' }),
      { routes: 'canonical' },
    );

    const post = await app.request('/chat/sessions/session_roundtrip/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'Hello server' }),
    });
    expect(post.status).toBe(200);
    const created = await post.json();
    expect(created.streamId).toBe(created.assistantMessageId);

    const stream = await app.request('/chat/sessions/session_roundtrip/stream?fromSeq=0');
    expect(stream.status).toBe(200);
    expect(stream.headers.get('content-type')).toContain('text/event-stream');
    const events = parseSse(await stream.text());
    expect(events).toEqual([
      {
        event: 'content_delta',
        data: {
          streamId: created.assistantMessageId,
          sequence: 1,
          data: { delta: 'Hello from the deterministic adapter.' },
        },
      },
      {
        event: 'done',
        data: {
          streamId: created.assistantMessageId,
          sequence: 2,
          data: {},
        },
      },
    ]);

    const bootstrap = await app.request('/chat/sessions/session_roundtrip/bootstrap');
    expect(bootstrap.status).toBe(200);
    expect(await bootstrap.json()).toEqual(
      expect.objectContaining({
        sessionId: 'session_roundtrip',
        messages: [
          expect.objectContaining({
            id: created.userMessageId,
            role: 'user',
            content: 'Hello server',
            sequence: 1,
          }),
          expect.objectContaining({
            id: created.assistantMessageId,
            role: 'assistant',
            content: 'Hello from the deterministic adapter.',
            sequence: 2,
          }),
        ],
        assistantDetailsByMessageId: {
          [created.assistantMessageId]: [
            expect.objectContaining({ eventType: 'content_delta', sequence: 1 }),
            expect.objectContaining({ eventType: 'done', sequence: 2 }),
          ],
        },
      }),
    );
  });

  it('exercises deterministic turn-control routes over the in-memory adapter', async () => {
    const app = createChatServer(createInMemoryChatServerDeps(), {
      routes: 'canonical',
    });

    const post = await app.request('/chat/sessions/session_controls/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'Control route baseline' }),
    });
    expect(post.status).toBe(200);
    const created = await post.json();

    const stop = await app.request(`/chat/messages/${created.assistantMessageId}/stop`, {
      method: 'POST',
    });
    expect(stop.status).toBe(200);
    expect(await stop.json()).toEqual({
      ok: true,
      jobId: `job_${created.assistantMessageId}`,
    });

    const steer = await app.request(`/chat/messages/${created.assistantMessageId}/steer`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        message: 'Focus on the control route contract.',
        metadata: { source: 'test' },
      }),
    });
    expect(steer.status).toBe(200);
    expect(await steer.json()).toEqual(
      expect.objectContaining({
        assistantMessageId: created.assistantMessageId,
        status: 'accepted',
        action: 'interrupt_relaunch',
        steer: expect.objectContaining({
          message: 'Focus on the control route contract.',
          metadata: { source: 'test' },
        }),
      }),
    );

    const feedback = await app.request(`/chat/messages/${created.assistantMessageId}/feedback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ vote: 'down' }),
    });
    expect(feedback.status).toBe(200);
    expect(await feedback.json()).toEqual({
      messageId: created.assistantMessageId,
      vote: -1,
    });

    const toolResult = await app.request(
      `/chat/messages/${created.assistantMessageId}/tool-results`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          toolCallId: 'call_local_1',
          result: { ok: true },
        }),
      },
    );
    expect(toolResult.status).toBe(200);
    expect(await toolResult.json()).toEqual({
      ok: true,
      accepted: true,
      resumed: true,
      jobId: expect.any(String),
    });

    const checkpoint = await app.request('/chat/sessions/session_controls/checkpoints', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Control checkpoint' }),
    });
    expect(checkpoint.status).toBe(200);
    const checkpointBody = await checkpoint.json();
    expect(checkpointBody.checkpoint).toEqual(
      expect.objectContaining({
        id: expect.any(String),
        title: 'Control checkpoint',
      }),
    );

    const listCheckpoints = await app.request('/chat/sessions/session_controls/checkpoints');
    expect(listCheckpoints.status).toBe(200);
    expect(await listCheckpoints.json()).toEqual(
      expect.objectContaining({
        sessionId: 'session_controls',
        checkpoints: [expect.objectContaining({ id: checkpointBody.checkpoint.id })],
      }),
    );

    const restore = await app.request(
      `/chat/sessions/session_controls/checkpoints/${checkpointBody.checkpoint.id}/restore`,
      { method: 'POST' },
    );
    expect(restore.status).toBe(200);
    expect(await restore.json()).toEqual(
      expect.objectContaining({
        sessionId: 'session_controls',
        checkpointId: checkpointBody.checkpoint.id,
        removedMessages: 0,
      }),
    );

    const retry = await app.request(`/chat/messages/${created.userMessageId}/retry`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'deterministic-model' }),
    });
    expect(retry.status).toBe(200);
    const retried = await retry.json();
    expect(retried).toEqual(
      expect.objectContaining({
        sessionId: 'session_controls',
        userMessageId: created.userMessageId,
        assistantMessageId: expect.any(String),
        streamId: retried.assistantMessageId,
        jobId: expect.any(String),
      }),
    );
  });
});
