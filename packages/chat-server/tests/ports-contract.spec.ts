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
});
