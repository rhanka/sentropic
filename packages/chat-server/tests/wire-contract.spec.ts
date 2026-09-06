import { describe, expect, it } from 'vitest';

import {
  createChatServer,
  createInMemoryChatServerDeps,
  readAppContractStreamEvents,
} from '../src/index';

describe('chat-server route mode contract', () => {
  it('serves the canonical chat-ui transport routes only in canonical mode', async () => {
    const app = createChatServer(createInMemoryChatServerDeps(), {
      routes: 'canonical',
    });

    const post = await app.request('/chat/sessions/session_a/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'hello canonical' }),
    });
    expect(post.status).toBe(200);
    expect(await post.json()).toEqual(
      expect.objectContaining({
        sessionId: 'session_a',
        userMessageId: expect.any(String),
        assistantMessageId: expect.any(String),
        streamId: expect.any(String),
        jobId: expect.any(String),
      }),
    );

    expect(
      await app.request('/chat/sessions/session_a/bootstrap'),
    ).toHaveProperty('status', 200);
    expect(
      await app.request('/chat/sessions/session_a/stream?fromSeq=0'),
    ).toHaveProperty('status', 200);
    expect(
      await app.request('/chat/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: 'legacy shape' }),
      }),
    ).toHaveProperty('status', 404);
  });

  it('serves the current app contract only in app-contract mode', async () => {
    const app = createChatServer(createInMemoryChatServerDeps(), {
      routes: 'app-contract',
    });

    const post = await app.request('/chat/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sessionId: 'session_app',
        content: 'hello app contract',
      }),
    });
    expect(post.status).toBe(200);
    expect(await post.json()).toEqual(
      expect.objectContaining({
        sessionId: 'session_app',
        userMessageId: expect.any(String),
        assistantMessageId: expect.any(String),
        streamId: expect.any(String),
        jobId: expect.any(String),
      }),
    );

    expect(
      await app.request('/chat/sessions/session_app/messages'),
    ).toHaveProperty('status', 200);
    expect(
      await app.request('/chat/sessions/session_app/bootstrap'),
    ).toHaveProperty('status', 200);
    expect(
      await app.request('/chat/sessions/session_app/stream?fromSeq=0'),
    ).toHaveProperty('status', 404);
  });

  it('can be mounted below an existing /chat router with an empty basePath', async () => {
    const app = createChatServer(createInMemoryChatServerDeps(), {
      routes: 'app-contract',
      basePath: '',
    });

    const post = await app.request('/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sessionId: 'session_nested_app',
        content: 'hello nested app contract',
      }),
    });
    expect(post.status).toBe(200);

    expect(
      await app.request('/sessions/session_nested_app/messages'),
    ).toHaveProperty('status', 200);
    expect(
      await app.request('/sessions/session_nested_app/bootstrap'),
    ).toHaveProperty('status', 200);
  });

  it('delegates app lifecycle and history routes to the session port', async () => {
    const app = createChatServer(createInMemoryChatServerDeps(), {
      routes: 'app-contract',
    });
    const created = await app.request('/chat/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionTitle: 'Factory session' }),
    });
    expect(created.status).toBe(200);
    const { sessionId } = await created.json();

    const listed = await app.request('/chat/sessions');
    expect(await listed.json()).toEqual({
      sessions: [expect.objectContaining({ id: sessionId, title: 'Factory session' })],
    });

    const history = await app.request(`/chat/sessions/${sessionId}/history`);
    expect(history.status).toBe(200);
    expect(history.headers.get('content-type')).toContain('application/x-ndjson');
    expect((await history.text()).split('\n')[0]).toBe(JSON.stringify({
      type: 'session_meta',
      sessionId,
      title: 'Factory session',
      todoRuntime: null,
      checkpoints: [],
      documents: [],
    }));

    expect((await app.request(`/chat/sessions/${sessionId}`, {
      method: 'DELETE',
    })).status).toBe(200);
    expect((await app.request(`/chat/sessions/${sessionId}/history`)).status).toBe(404);
  });

  it('rejects study-spec futures that are not shipped in BR-42a0', async () => {
    const app = createChatServer(createInMemoryChatServerDeps(), {
      routes: 'canonical',
    });

    const versioned = await app.request('/chat/sessions/session_a/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'sec-sentropic-wire-version': '2026-01-draft',
      },
      body: JSON.stringify({ content: 'future header' }),
    });
    expect(versioned.status).toBe(400);
    expect(await versioned.json()).toEqual({
      error: 'Sec-Sentropic-Wire-Version is not supported',
    });

    const replay = await app.request('/chat/sessions/session_a/events?fromSeq=1');
    expect(replay.status).toBe(404);
  });

  it('delegates app-contract stream replay through the chat stream port', async () => {
    const calls: unknown[] = [];
    const events = await readAppContractStreamEvents(
      {
        readSessionEvents: async () => [],
        isStreamAllowed: async (input) => {
          calls.push(['allowed', input]);
          return true;
        },
        readStreamEvents: async (input) => {
          calls.push(['read', input]);
          return [
            {
              streamId: input.streamId,
              eventType: 'content_delta',
              data: { delta: 'Hello' },
              sequence: 2,
            },
          ];
        },
      },
      {
        streamId: 'assistant-1',
        userId: 'user-1',
        workspaceId: 'workspace-1',
        sinceSequence: 1,
      },
    );

    expect(events).toEqual([
      {
        streamId: 'assistant-1',
        eventType: 'content_delta',
        data: { delta: 'Hello' },
        sequence: 2,
      },
    ]);
    expect(calls).toEqual([
      [
        'allowed',
        {
          streamId: 'assistant-1',
          userId: 'user-1',
          workspaceId: 'workspace-1',
        },
      ],
      [
        'read',
        {
          streamId: 'assistant-1',
          userId: 'user-1',
          sinceSequence: 1,
        },
      ],
    ]);
  });
});
