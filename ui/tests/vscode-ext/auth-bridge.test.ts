import { describe, expect, it, vi } from 'vitest';
import {
  VSCODE_AUTH_COMMANDS,
  createVsCodeAuthBridge,
} from '../../vscode-ext/auth-bridge';

describe('vscode auth bridge', () => {
  it('requests codex status from host', async () => {
    const request = vi.fn().mockResolvedValue({
      connected: true,
      accountLabel: 'dev@example.com',
    });

    const bridge = createVsCodeAuthBridge({
      request,
      notify: vi.fn(),
      onEvent: vi.fn(() => () => {}),
      dispose: vi.fn(),
    });

    const status = await bridge.getCodexStatus();

    expect(request).toHaveBeenCalledWith(VSCODE_AUTH_COMMANDS.codexStatus);
    expect(status).toEqual({
      connected: true,
      accountLabel: 'dev@example.com',
    });
  });

  it('requests codex sign-in from host', async () => {
    const request = vi.fn().mockResolvedValue({
      opened: true,
      url: 'https://chatgpt.com/auth',
    });

    const bridge = createVsCodeAuthBridge({
      request,
      notify: vi.fn(),
      onEvent: vi.fn(() => () => {}),
      dispose: vi.fn(),
    });

    const result = await bridge.openCodexSignIn();

    expect(request).toHaveBeenCalledWith(VSCODE_AUTH_COMMANDS.codexSignIn);
    expect(result.opened).toBe(true);
  });
});
