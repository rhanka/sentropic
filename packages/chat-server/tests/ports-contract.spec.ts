import { describe, expect, it } from 'vitest';

import { createChatServer, createInMemoryChatServerDeps } from '../src/index';

describe('chat-server ports contract', () => {
  it('rejects missing dependency objects', () => {
    expect(() =>
      createChatServer(undefined as never, { routes: 'canonical' }),
    ).toThrow(/deps/i);
  });

  it('rejects unknown route modes', () => {
    const deps = createInMemoryChatServerDeps();

    expect(() =>
      createChatServer(deps, { routes: 'unknown' as never }),
    ).toThrow(/routes/i);
  });

  it('exposes session lifecycle through an injected provider port', async () => {
    const deps = createInMemoryChatServerDeps();
    expect(deps.sessions).toBeDefined();

    const created = await deps.sessions!.createSession({
      userId: 'test-user',
      workspaceId: 'test-workspace',
      title: 'Port-owned session',
    });
    await expect(deps.sessions!.listSessions({
      userId: 'test-user',
      workspaceId: 'test-workspace',
    })).resolves.toEqual([
      expect.objectContaining({ id: created.sessionId, title: 'Port-owned session' }),
    ]);
  });
});
