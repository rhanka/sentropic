import { describe, expect, it } from 'vitest';

import { createChatServer, createInMemoryChatServerDeps } from '../src/index';

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
});
