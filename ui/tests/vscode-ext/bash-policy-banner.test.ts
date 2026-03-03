import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  LocalToolPermissionRequiredError,
  decideLocalToolPermission,
  executeLocalTool,
} from '../../src/lib/stores/localTools';

describe('vscode bash policy banner bridge', () => {
  beforeEach(() => {
    delete (globalThis as any).chrome;
  });

  it('raises permission_required and forwards decision payload', async () => {
    const sendMessage = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        error: 'permission_required',
        permissionRequest: {
          requestId: 'perm-100',
          toolName: 'bash:echo',
          origin: 'vscode://workspace',
          details: { command: 'echo hello' },
        },
      })
      .mockResolvedValueOnce({ ok: true });

    (globalThis as any).chrome = {
      runtime: {
        id: 'topai.vscode.runtime',
        sendMessage,
      },
    };

    await expect(
      executeLocalTool('tool-call-1', 'bash', { command: 'echo hello' }),
    ).rejects.toBeInstanceOf(LocalToolPermissionRequiredError);

    await expect(
      decideLocalToolPermission('perm-100', 'allow_once'),
    ).resolves.toBeUndefined();

    expect(sendMessage).toHaveBeenNthCalledWith(2, {
      type: 'tool_permission_decide',
      payload: {
        requestId: 'perm-100',
        decision: 'allow_once',
      },
    });
  });
});
