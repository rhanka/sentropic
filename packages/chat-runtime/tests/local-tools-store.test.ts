/**
 * BR14a Lot 5 — @sentropic/chat-ui/stores/localTools contract tests.
 *
 * These tests exercise the package-owned UI-generic core (definitions,
 * runtime detection, execute/permission/permission-policy flows) via
 * the injected `LocalToolsAdapter`, mirroring host behavior without
 * touching `globalThis.chrome`. Host-app coverage continues in
 * `ui/tests/stores/localTools.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

import type { LocalToolsAdapter } from '../src/hosts/types.js';
import {
  BUILTIN_LOCAL_TOOL_NAMES,
  LocalToolPermissionRequiredError,
  clearRegisteredLocalTools,
  decideLocalToolPermission,
  deleteLocalToolPermissionPolicy,
  executeLocalTool,
  getLocalToolDefinitions,
  isLocalToolName,
  isLocalToolRuntimeAvailable,
  listLocalToolPermissionPolicies,
  listRegisteredLocalTools,
  localToolsStore,
  registerLocalTool,
  registerLocalTools,
  setLocalToolsAdapter,
  unregisterLocalTool,
  upsertLocalToolPermissionPolicy,
} from '../src/stores/localTools.js';

const RENDER_MERMAID = {
  name: 'render_mermaid',
  description: 'Render a Mermaid diagram in the host app.',
  parameters: {
    type: 'object',
    properties: { source: { type: 'string' } },
    required: ['source'],
  },
} as const;

const resetState = () => {
  localToolsStore.set({
    available: false,
    tools: getLocalToolDefinitions(),
    executions: {},
  });
};

const useAdapter = (adapter: LocalToolsAdapter | null) => {
  setLocalToolsAdapter(adapter);
};

describe('@sentropic/chat-ui local tools store', () => {
  beforeEach(() => {
    setLocalToolsAdapter(null);
    clearRegisteredLocalTools();
    resetState();
  });

  afterEach(() => {
    setLocalToolsAdapter(null);
    clearRegisteredLocalTools();
  });

  it('exposes Chrome-mode definitions when no runtime is configured', () => {
    const definitions = getLocalToolDefinitions();
    expect(definitions.map((tool) => tool.name).sort()).toEqual([
      'tab_action',
      'tab_read',
    ]);
    expect(isLocalToolName('tab_read')).toBe(true);
    expect(isLocalToolName('tab_info')).toBe(true);
    expect(isLocalToolName('unknown_tool')).toBe(false);
    expect(isLocalToolRuntimeAvailable()).toBe(false);
  });

  it('switches to VSCode tool catalog when adapter id is sentropic.vscode.runtime', () => {
    useAdapter({
      id: 'sentropic.vscode.runtime',
      sendMessage: vi.fn(),
    });

    const definitions = getLocalToolDefinitions();
    expect(definitions.map((tool) => tool.name).sort()).toEqual([
      'bash',
      'file_edit',
      'file_read',
      'git',
      'ls',
      'rg',
    ]);
    expect(isLocalToolRuntimeAvailable()).toBe(true);
  });

  it('executes a local tool and stores completed state through the adapter', async () => {
    const sendMessage = vi
      .fn()
      .mockResolvedValue({ ok: true, result: { title: 'Example' } });
    useAdapter({ id: 'ext-1', sendMessage });

    const result = await executeLocalTool(
      'call-1',
      'tab_read',
      { mode: 'info' },
      { streamId: 'stream-1' },
    );

    expect(result).toEqual({ title: 'Example' });
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'tool_execute',
      toolCallId: 'call-1',
      name: 'tab_read',
      args: { mode: 'info' },
    });
    const state = get(localToolsStore);
    expect(state.executions['call-1']).toMatchObject({
      toolCallId: 'call-1',
      streamId: 'stream-1',
      status: 'completed',
      result: { title: 'Example' },
    });
  });

  it('raises LocalToolPermissionRequiredError when adapter requests consent', async () => {
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
    useAdapter({ id: 'ext-1', sendMessage });

    await expect(
      executeLocalTool('call-p', 'tab_read', { mode: 'dom' }),
    ).rejects.toBeInstanceOf(LocalToolPermissionRequiredError);

    const state = get(localToolsStore);
    expect(state.executions['call-p']).toMatchObject({
      status: 'awaiting_permission',
      permissionRequest: { requestId: 'perm-1' },
    });

    await expect(
      decideLocalToolPermission('perm-1', 'allow_once'),
    ).resolves.toBeUndefined();
    expect(sendMessage).toHaveBeenNthCalledWith(2, {
      type: 'tool_permission_decide',
      payload: { requestId: 'perm-1', decision: 'allow_once' },
    });
  });

  it('stores failed state when adapter returns ok=false', async () => {
    const sendMessage = vi
      .fn()
      .mockResolvedValue({ ok: false, error: 'Tool execution failed' });
    useAdapter({ id: 'ext-1', sendMessage });

    await expect(
      executeLocalTool('call-fail', 'tab_action', {
        action: 'click',
        selector: '#main',
      }),
    ).rejects.toThrow('Tool execution failed');

    expect(get(localToolsStore).executions['call-fail']).toMatchObject({
      status: 'failed',
      error: 'Tool execution failed',
    });
  });

  it('fails fast when no adapter is wired and globalThis.chrome.runtime is absent', async () => {
    await expect(
      executeLocalTool('call-x', 'tab_read', { mode: 'screenshot' }),
    ).rejects.toThrow(/unavailable outside extension context/i);
  });

  it('forwards extension permission policy CRUD through the adapter', async () => {
    const sendMessage = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        items: [
          {
            toolName: 'ls',
            origin: 'vscode://workspace',
            policy: 'allow',
            pathPattern: 'src/*',
            updatedAt: '2026-03-03T00:00:00.000Z',
          },
        ],
      })
      .mockResolvedValueOnce({
        ok: true,
        item: {
          toolName: 'file_edit',
          origin: 'vscode://workspace',
          policy: 'deny',
          pathPattern: 'secrets/*',
          updatedAt: '2026-03-03T00:00:01.000Z',
        },
      })
      .mockResolvedValueOnce({ ok: true });
    useAdapter({ id: 'sentropic.vscode.runtime', sendMessage });

    const items = await listLocalToolPermissionPolicies();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ toolName: 'ls', pathPattern: 'src/*' });

    const upserted = await upsertLocalToolPermissionPolicy({
      toolName: 'file_edit',
      origin: 'vscode://workspace',
      policy: 'deny',
      pathPattern: 'secrets/*',
    });
    expect(upserted).toMatchObject({
      toolName: 'file_edit',
      pathPattern: 'secrets/*',
    });

    await deleteLocalToolPermissionPolicy({
      toolName: 'file_edit',
      origin: 'vscode://workspace',
      pathPattern: 'secrets/*',
    });
    expect(sendMessage).toHaveBeenNthCalledWith(3, {
      type: 'extension_tool_permissions_delete',
      payload: {
        toolName: 'file_edit',
        origin: 'vscode://workspace',
        pathPattern: 'secrets/*',
      },
    });
  });

  it('clears injected adapter when setLocalToolsAdapter(null) is called', () => {
    useAdapter({ id: 'ext-x', sendMessage: vi.fn() });
    expect(isLocalToolRuntimeAvailable()).toBe(true);
    useAdapter(null);
    expect(isLocalToolRuntimeAvailable()).toBe(false);
  });
});

describe('@sentropic/chat-ui local tools — external host registration seam', () => {
  beforeEach(() => {
    setLocalToolsAdapter(null);
    clearRegisteredLocalTools();
    resetState();
  });

  afterEach(() => {
    setLocalToolsAdapter(null);
    clearRegisteredLocalTools();
  });

  it('exposes the 16 sentropic built-in names as a frozen-ish const set', () => {
    expect([...BUILTIN_LOCAL_TOOL_NAMES]).toEqual([
      'tab_read',
      'tab_action',
      'tab_read_dom',
      'tab_screenshot',
      'tab_click',
      'tab_type',
      'tab_scroll',
      'tab_info',
      'bash',
      'ls',
      'rg',
      'file_read',
      'file_edit',
      'git',
      'git_status',
      'git_diff',
    ]);
  });

  it('recognizes a custom name only after the host registers it', () => {
    expect(isLocalToolName('render_mermaid')).toBe(false);
    registerLocalTool(RENDER_MERMAID);
    expect(isLocalToolName('render_mermaid')).toBe(true);
    // Built-ins keep being recognized — no behavior change for sentropic tools.
    expect(isLocalToolName('bash')).toBe(true);
    expect(isLocalToolName('tab_read')).toBe(true);
    // Unknown unregistered names stay rejected.
    expect(isLocalToolName('totally_unknown')).toBe(false);
  });

  it('appends host-registered definitions to runtime built-ins (Chrome mode)', () => {
    registerLocalTool(RENDER_MERMAID);
    const names = getLocalToolDefinitions().map((tool) => tool.name);
    // Chrome built-ins are preserved (additive, not replaced).
    expect(names).toContain('tab_read');
    expect(names).toContain('tab_action');
    expect(names).toContain('render_mermaid');
    const def = getLocalToolDefinitions().find((t) => t.name === 'render_mermaid');
    expect(def).toMatchObject({
      name: 'render_mermaid',
      description: RENDER_MERMAID.description,
    });
  });

  it('appends host-registered definitions to VSCode built-ins too', () => {
    useAdapter({ id: 'sentropic.vscode.runtime', sendMessage: vi.fn() });
    registerLocalTool(RENDER_MERMAID);
    const names = getLocalToolDefinitions().map((tool) => tool.name).sort();
    expect(names).toEqual([
      'bash',
      'file_edit',
      'file_read',
      'git',
      'ls',
      'render_mermaid',
      'rg',
    ]);
  });

  it('registers multiple tools and preserves registration order', () => {
    registerLocalTools([
      { ...RENDER_MERMAID, name: 'render_mermaid' },
      { ...RENDER_MERMAID, name: 'render_chart', description: 'Chart.' },
    ]);
    const registered = listRegisteredLocalTools().map((t) => t.name);
    expect(registered).toEqual(['render_mermaid', 'render_chart']);
  });

  it('overrides a built-in definition by name without removing recognition', () => {
    registerLocalTool({
      name: 'tab_read',
      description: 'Host-overridden tab_read.',
      parameters: { type: 'object', properties: {} },
    });
    const defs = getLocalToolDefinitions();
    // No duplicate tab_read entry — deduped by name.
    expect(defs.filter((t) => t.name === 'tab_read')).toHaveLength(1);
    expect(defs.find((t) => t.name === 'tab_read')?.description).toBe(
      'Host-overridden tab_read.',
    );
    // Built-in recognition cannot be removed via the registry.
    unregisterLocalTool('tab_read');
    expect(isLocalToolName('tab_read')).toBe(true);
  });

  it('unregister and clear restore the pre-registration recognition state', () => {
    registerLocalTool(RENDER_MERMAID);
    expect(isLocalToolName('render_mermaid')).toBe(true);
    expect(unregisterLocalTool('render_mermaid')).toBe(true);
    expect(isLocalToolName('render_mermaid')).toBe(false);
    expect(unregisterLocalTool('render_mermaid')).toBe(false);

    registerLocalTool(RENDER_MERMAID);
    clearRegisteredLocalTools();
    expect(isLocalToolName('render_mermaid')).toBe(false);
    expect(listRegisteredLocalTools()).toEqual([]);
  });

  it('trims the registration key (whitespace-only names rejected)', () => {
    registerLocalTool({ ...RENDER_MERMAID, name: '  render_mermaid  ' });
    expect(isLocalToolName('render_mermaid')).toBe(true);
    expect(() =>
      registerLocalTool({ ...RENDER_MERMAID, name: '   ' }),
    ).toThrow(/non-empty tool name/i);
  });

  it('returns defensive copies from listRegisteredLocalTools', () => {
    registerLocalTool(RENDER_MERMAID);
    const snapshot = listRegisteredLocalTools();
    snapshot[0]!.description = 'mutated';
    expect(listRegisteredLocalTools()[0]!.description).toBe(
      RENDER_MERMAID.description,
    );
  });
});
