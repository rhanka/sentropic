import { describe, expect, it, vi } from 'vitest';

import {
  createTopAiVsCodeRequestHandler,
  type TopAiRuntimeConfig,
} from '../../vscode-ext/host-handler';

const createRuntimeConfig = (
  overrides?: Partial<TopAiRuntimeConfig>,
): TopAiRuntimeConfig => ({
  apiBaseUrl: 'http://localhost:8705/api/v1',
  appBaseUrl: 'http://localhost:5173',
  sessionToken: 'session-token-1',
  codexSignInUrl: 'https://chatgpt.com/auth/login?next=/codex',
  ...overrides,
});

describe('vscode extension runtime host handler', () => {
  it('returns runtime config for runtime.config.get', async () => {
    const handler = createTopAiVsCodeRequestHandler({
      getRuntimeConfig: () => createRuntimeConfig(),
      openExternal: vi.fn(async () => true),
      getCodexConnected: () => false,
      setCodexConnected: vi.fn(async () => undefined),
    });

    await expect(handler('runtime.config.get')).resolves.toEqual(createRuntimeConfig());
  });

  it('opens Codex sign-in URL and reports connected status', async () => {
    let connected = false;
    const setConnected = vi.fn(async (value: boolean) => {
      connected = value;
    });
    const openExternal = vi.fn(async () => true);

    const handler = createTopAiVsCodeRequestHandler({
      getRuntimeConfig: () => createRuntimeConfig(),
      openExternal,
      getCodexConnected: () => connected,
      setCodexConnected: setConnected,
    });

    const signInResult = await handler('auth.codex.signIn');
    const statusResult = await handler('auth.codex.status');

    expect(signInResult).toEqual({
      opened: true,
      url: 'https://chatgpt.com/auth/login?next=/codex',
    });
    expect(statusResult).toEqual({
      connected: true,
      accountLabel: null,
      reason: 'Codex sign-in initiated in this extension profile.',
    });
    expect(openExternal).toHaveBeenCalledWith(
      'https://chatgpt.com/auth/login?next=/codex',
    );
    expect(setConnected).toHaveBeenCalledWith(true);
  });

  it('returns disconnected status before sign-in', async () => {
    const handler = createTopAiVsCodeRequestHandler({
      getRuntimeConfig: () => createRuntimeConfig(),
      openExternal: vi.fn(async () => true),
      getCodexConnected: () => false,
      setCodexConnected: vi.fn(async () => undefined),
    });

    await expect(handler('auth.codex.status')).resolves.toEqual({
      connected: false,
      accountLabel: null,
      reason: 'not_connected',
    });
  });
});
