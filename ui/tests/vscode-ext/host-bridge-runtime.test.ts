import { describe, expect, it, vi } from 'vitest';

import {
  createTopAiVsCodeRequestHandler,
  type RuntimeHttpRequestResult,
  type TopAiRuntimeConfig,
} from '../../vscode-ext/host-handler';

const createRuntimeConfig = (
  overrides?: Partial<TopAiRuntimeConfig>,
): TopAiRuntimeConfig => ({
  apiBaseUrl: 'http://localhost:8787/api/v1',
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

describe('vscode host bridge runtime http transport', () => {
  it('delegates runtime.http.request payloads to host dependency', async () => {
    const hostResult: RuntimeHttpRequestResult = {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/json' },
      bodyText: '{"ok":true}',
    };
    const performRuntimeHttpRequest = vi.fn().mockResolvedValue(hostResult);

    const handler = createTopAiVsCodeRequestHandler({
      getRuntimeConfig: () => createRuntimeConfig(),
      performRuntimeHttpRequest,
    });

    await expect(
      handler('runtime.http.request', {
        url: 'http://localhost:8787/api/v1/chat/messages',
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        bodyText: '{"content":"hello"}',
      }),
    ).resolves.toEqual(hostResult);

    expect(performRuntimeHttpRequest).toHaveBeenCalledWith({
      url: 'http://localhost:8787/api/v1/chat/messages',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      bodyText: '{"content":"hello"}',
    });
  });

  it('fails with explicit unsupported command error when runtime.http.request is not wired', async () => {
    const handler = createTopAiVsCodeRequestHandler({
      getRuntimeConfig: () => createRuntimeConfig(),
    });

    await expect(
      handler('runtime.http.request', {
        url: 'http://localhost:8787/api/v1/chat/messages',
        method: 'GET',
      }),
    ).rejects.toThrow('Unsupported command: runtime.http.request');
  });
});
