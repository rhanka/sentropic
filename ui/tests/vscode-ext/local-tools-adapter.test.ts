import { describe, expect, it, vi } from 'vitest';

import { createVsCodeLocalToolsAdapter } from '../../vscode-ext/local-tools-adapter';
import type { VsCodeBridge } from '../../vscode-ext/vscode-bridge';

const createMockBridge = (
  request: ReturnType<typeof vi.fn>,
): VsCodeBridge => ({
  request: request as unknown as VsCodeBridge['request'],
  notify: vi.fn(),
  onEvent: vi.fn(() => () => undefined),
  dispose: vi.fn(),
});

describe('createVsCodeLocalToolsAdapter', () => {
  it('routes tool_execute through runtime.local_tools.execute', async () => {
    const request = vi.fn().mockResolvedValue({ ok: true, result: 42 });
    const adapter = createVsCodeLocalToolsAdapter({
      bridge: createMockBridge(request),
    });

    const response = await adapter.sendMessage?.({
      type: 'tool_execute',
      toolCallId: 'tc-1',
      name: 'bash',
      args: { command: 'echo hi' },
    });

    expect(adapter.id).toBe('sentropic.vscode.runtime');
    expect(request).toHaveBeenCalledWith('runtime.local_tools.execute', {
      toolCallId: 'tc-1',
      name: 'bash',
      args: { command: 'echo hi' },
    });
    expect(response).toEqual({ ok: true, result: 42 });
  });

  it('routes tool_permission_decide payloads to the bridge', async () => {
    const request = vi.fn().mockResolvedValue({ ok: true });
    const adapter = createVsCodeLocalToolsAdapter({
      bridge: createMockBridge(request),
    });

    await adapter.sendMessage?.({
      type: 'tool_permission_decide',
      payload: { requestId: 'r-1', decision: 'allow_once' },
    });

    expect(request).toHaveBeenCalledWith(
      'runtime.local_tools.permission_decide',
      { requestId: 'r-1', decision: 'allow_once' },
    );
  });

  it('routes extension_tool_permissions_* messages to the policies bridge commands', async () => {
    const request = vi.fn().mockResolvedValue({ ok: true, items: [] });
    const adapter = createVsCodeLocalToolsAdapter({
      bridge: createMockBridge(request),
    });

    await adapter.sendMessage?.({ type: 'extension_tool_permissions_list' });
    await adapter.sendMessage?.({
      type: 'extension_tool_permissions_upsert',
      payload: { toolName: 'bash:git', origin: 'vscode://workspace', policy: 'allow' },
    });
    await adapter.sendMessage?.({
      type: 'extension_tool_permissions_delete',
      payload: { toolName: 'bash:git', origin: 'vscode://workspace' },
    });

    expect(request).toHaveBeenNthCalledWith(
      1,
      'runtime.local_tools.permissions.list',
    );
    expect(request).toHaveBeenNthCalledWith(
      2,
      'runtime.local_tools.permissions.upsert',
      { toolName: 'bash:git', origin: 'vscode://workspace', policy: 'allow' },
    );
    expect(request).toHaveBeenNthCalledWith(
      3,
      'runtime.local_tools.permissions.delete',
      { toolName: 'bash:git', origin: 'vscode://workspace' },
    );
  });

  it('returns an error envelope when bridge is missing', async () => {
    const adapter = createVsCodeLocalToolsAdapter({ bridge: null });

    const response = await adapter.sendMessage?.({ type: 'tool_execute' });

    expect(response).toMatchObject({
      ok: false,
      error: 'Local tool runtime is unavailable in this context.',
    });
  });

  it('returns an error envelope for unsupported message types', async () => {
    const request = vi.fn();
    const adapter = createVsCodeLocalToolsAdapter({
      bridge: createMockBridge(request),
    });

    const response = await adapter.sendMessage?.({ type: 'unknown_command' });

    expect(request).not.toHaveBeenCalled();
    expect(response).toMatchObject({
      ok: false,
      error: 'Unsupported runtime message: unknown_command',
    });
  });
});
