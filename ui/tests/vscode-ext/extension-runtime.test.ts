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
  codeAgentPromptDefault: 'default prompt',
  codeAgentPromptGlobal: '',
  codeAgentPromptWorkspace: '',
  codeAgentPromptEffective: 'default prompt',
  codeAgentPromptSource: 'default',
  instructionIncludePatterns: [],
  workspaceScopeKey: '/repo',
  workspaceScopeLabel: 'repo',
  projectFingerprint: 'fp_repo_1',
  workspaceScopeWorkspaceId: 'ws_1',
  workspaceScopeLastWorkspaceId: 'ws_1',
  codeWorkspaces: [
    {
      id: 'ws_1',
      name: 'Code Workspace',
      role: 'admin',
    },
  ],
  ...overrides,
});

describe('vscode extension runtime host handler', () => {
  it('returns runtime config for runtime.config.get', async () => {
    const handler = createTopAiVsCodeRequestHandler({
      getRuntimeConfig: () => createRuntimeConfig(),
    });

    await expect(handler('runtime.config.get')).resolves.toEqual(createRuntimeConfig());
  });

  it('supports runtime.auth.validate when validate handler is provided', async () => {
    const handler = createTopAiVsCodeRequestHandler({
      getRuntimeConfig: () => createRuntimeConfig(),
      validateRuntimeAuth: () => ({
        connected: true,
        reason: 'connected',
        user: {
          id: 'u_1',
          email: 'admin@example.com',
          displayName: 'Admin',
          role: 'admin_app',
        },
      }),
    });

    await expect(handler('runtime.auth.validate')).resolves.toEqual({
      connected: true,
      reason: 'connected',
      user: {
        id: 'u_1',
        email: 'admin@example.com',
        displayName: 'Admin',
        role: 'admin_app',
      },
    });
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
