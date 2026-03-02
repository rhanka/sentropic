import { describe, expect, it } from 'vitest';

import {
  createTopAiVsCodeRequestHandler,
  type TopAiRuntimeConfig,
} from '../../vscode-ext/host-handler';

const createRuntimeConfig = (
  overrides?: Partial<TopAiRuntimeConfig>,
): TopAiRuntimeConfig => ({
  apiBaseUrl: 'http://localhost:8705/api/v1',
  appBaseUrl: 'http://localhost:5173',
  wsBaseUrl: '',
  sessionToken: 'session-token-1',
  codexSignInUrl: 'https://chatgpt.com/auth/login?next=/codex',
  ...overrides,
});

describe('vscode extension runtime host handler', () => {
  it('returns runtime config for runtime.config.get', async () => {
    const handler = createTopAiVsCodeRequestHandler({
      getRuntimeConfig: () => createRuntimeConfig(),
    });

    await expect(handler('runtime.config.get')).resolves.toEqual(createRuntimeConfig());
  });

  it('throws for unsupported commands', async () => {
    const handler = createTopAiVsCodeRequestHandler({
      getRuntimeConfig: () => createRuntimeConfig(),
    });

    await expect(handler('auth.codex.signIn' as any)).rejects.toThrow(
      'Unsupported command: auth.codex.signIn',
    );
  });
});
