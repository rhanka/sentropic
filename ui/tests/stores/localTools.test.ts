import { beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import {
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
      'tab_click',
      'tab_info',
      'tab_read_dom',
      'tab_screenshot',
      'tab_scroll',
      'tab_type',
    ]);
    expect(isLocalToolName('tab_info')).toBe(true);
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

    const result = await executeLocalTool('call-1', 'tab_info', {}, {
      streamId: 'stream-1',
    });

    expect(result).toEqual({ title: 'Example' });
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'tool_execute',
      toolCallId: 'call-1',
      name: 'tab_info',
      args: {},
    });

    const state = get(localToolsStore);
    expect(state.available).toBe(true);
    expect(state.executions['call-1']).toMatchObject({
      toolCallId: 'call-1',
      streamId: 'stream-1',
      name: 'tab_info',
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
      executeLocalTool('call-2', 'tab_read_dom', { selector: '#main' })
    ).rejects.toThrow('Tool execution failed');

    const state = get(localToolsStore);
    expect(state.executions['call-2']).toMatchObject({
      toolCallId: 'call-2',
      name: 'tab_read_dom',
      status: 'failed',
      error: 'Tool execution failed',
    });
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
      executeLocalTool('call-3', 'tab_scroll', { direction: 'down' })
    ).rejects.toThrow('runtime down');

    const state = get(localToolsStore);
    expect(state.executions['call-3']).toMatchObject({
      toolCallId: 'call-3',
      name: 'tab_scroll',
      status: 'failed',
      error: 'runtime down',
    });
  });

  it('fails fast outside extension runtime', async () => {
    await expect(
      executeLocalTool('call-4', 'tab_screenshot', {})
    ).rejects.toThrow(/unavailable outside extension context/i);
  });
});
