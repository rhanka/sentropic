import { beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import {
  LocalToolPermissionRequiredError,
  decideLocalToolPermission,
  executeLocalTool,
  getLocalToolDefinitions,
  isLocalToolName,
  localToolsStore,
} from '../../src/lib/stores/localTools';

const resetLocalToolsState = () => {
  localToolsStore.set({
    available: false,
    tools: getLocalToolDefinitions(),
    executions: {},
  });
};

describe('localTools store', () => {
  beforeEach(() => {
    resetLocalToolsState();
    delete (globalThis as any).chrome;
  });

  it('registers the expected built-in local tool definitions', () => {
    const definitions = getLocalToolDefinitions();
    expect(definitions.map((tool) => tool.name).sort()).toEqual([
      'tab_action',
      'tab_read',
    ]);
    expect(isLocalToolName('tab_read')).toBe(true);
    expect(isLocalToolName('tab_info')).toBe(true); // legacy compatibility
    expect(isLocalToolName('unknown_tool')).toBe(false);
  });

  it('executes a local tool successfully and stores completed state', async () => {
    const sendMessage = vi.fn().mockResolvedValue({
      ok: true,
      result: { title: 'Example' },
    });
    (globalThis as any).chrome = {
      runtime: {
        id: 'ext-1',
        sendMessage,
      },
    };

    const result = await executeLocalTool(
      'call-1',
      'tab_read',
      { mode: 'info' },
      {
      streamId: 'stream-1',
      },
    );

    expect(result).toEqual({ title: 'Example' });
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'tool_execute',
      toolCallId: 'call-1',
      name: 'tab_read',
      args: { mode: 'info' },
    });

    const state = get(localToolsStore);
    expect(state.available).toBe(true);
    expect(state.executions['call-1']).toMatchObject({
      toolCallId: 'call-1',
      streamId: 'stream-1',
      name: 'tab_read',
      status: 'completed',
      result: { title: 'Example' },
    });
  });

  it('stores failed state when runtime returns ok=false', async () => {
    const sendMessage = vi.fn().mockResolvedValue({
      ok: false,
      error: 'Tool execution failed',
    });
    (globalThis as any).chrome = {
      runtime: {
        id: 'ext-1',
        sendMessage,
      },
    };

    await expect(
      executeLocalTool('call-2', 'tab_action', {
        action: 'click',
        selector: '#main',
      })
    ).rejects.toThrow('Tool execution failed');

    const state = get(localToolsStore);
    expect(state.executions['call-2']).toMatchObject({
      toolCallId: 'call-2',
      name: 'tab_action',
      status: 'failed',
      error: 'Tool execution failed',
    });
  });

  it('returns a dedicated permission-required error when background requests consent', async () => {
    const sendMessage = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        error: 'permission_required',
        permissionRequest: {
          requestId: 'perm-1',
          toolName: 'tab_read:dom',
          origin: 'https://example.com',
        },
      })
      .mockResolvedValueOnce({ ok: true });
    (globalThis as any).chrome = {
      runtime: {
        id: 'ext-1',
        sendMessage,
      },
    };

    await expect(
      executeLocalTool('call-p', 'tab_read', { mode: 'dom' })
    ).rejects.toBeInstanceOf(LocalToolPermissionRequiredError);

    const state = get(localToolsStore);
    expect(state.executions['call-p']).toMatchObject({
      toolCallId: 'call-p',
      name: 'tab_read',
      status: 'awaiting_permission',
      permissionRequest: {
        requestId: 'perm-1',
      },
    });

    await expect(
      decideLocalToolPermission('perm-1', 'allow_once')
    ).resolves.toBeUndefined();
  });

  it('stores failed state when runtime sendMessage throws', async () => {
    const sendMessage = vi.fn().mockRejectedValue(new Error('runtime down'));
    (globalThis as any).chrome = {
      runtime: {
        id: 'ext-1',
        sendMessage,
      },
    };

    await expect(
      executeLocalTool('call-3', 'tab_action', {
        action: 'scroll',
        direction: 'down',
      })
    ).rejects.toThrow('runtime down');

    const state = get(localToolsStore);
    expect(state.executions['call-3']).toMatchObject({
      toolCallId: 'call-3',
      name: 'tab_action',
      status: 'failed',
      error: 'runtime down',
    });
  });

  it('fails fast outside extension runtime', async () => {
    await expect(
      executeLocalTool('call-4', 'tab_read', { mode: 'screenshot' })
    ).rejects.toThrow(/unavailable outside extension context/i);
  });
});
