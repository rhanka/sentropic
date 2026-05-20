/**
 * BR14a Lot 5 — VSCode webview-side `LocalToolsAdapter` implementation.
 *
 * Wraps the VSCode bridge so the @sentropic/chat-ui `stores/localTools`
 * module can post messages to the VSCode extension host without
 * touching `globalThis.chrome.runtime` directly. The previous wiring
 * relied on `installExtensionRuntimeShim` polluting `globalThis.chrome`
 * so the package fallback path could find a runtime; this adapter makes
 * the dependency explicit and is injected via `setLocalToolsAdapter`.
 *
 * The host-side runtime (`ui/vscode-ext/local-tools.ts`,
 * `VsCodeLocalToolsRuntime`) remains the single backend implementation
 * called through the bridge command `runtime.local_tools.*`. This file
 * is only the webview-facing transport contract.
 */
import type { LocalToolsAdapter } from '@sentropic/chat-ui/hosts/types';

import type { VsCodeBridge } from './vscode-bridge';

const RUNTIME_ID = 'topai.vscode.runtime';

type ExtensionMessage = {
  type?: unknown;
  payload?: unknown;
  toolCallId?: unknown;
  name?: unknown;
  args?: unknown;
};

type ExtensionResponse = {
  ok?: boolean;
  result?: unknown;
  error?: string;
  permissionRequest?: unknown;
  items?: unknown;
  item?: unknown;
};

export type CreateVsCodeLocalToolsAdapterOptions = {
  bridge: VsCodeBridge | null;
};

export const createVsCodeLocalToolsAdapter = (
  options: CreateVsCodeLocalToolsAdapterOptions,
): LocalToolsAdapter => {
  const bridge = options.bridge;

  const sendMessage = async (raw: unknown): Promise<ExtensionResponse> => {
    if (!bridge) {
      return {
        ok: false,
        error: 'Local tool runtime is unavailable in this context.',
      };
    }
    const message = (raw ?? {}) as ExtensionMessage;
    const type = typeof message.type === 'string' ? message.type : '';

    if (type === 'tool_execute') {
      const argsPayload =
        message.args && typeof message.args === 'object'
          ? (message.args as Record<string, unknown>)
          : message.payload && typeof message.payload === 'object'
            ? (message.payload as Record<string, unknown>)
            : {};
      return bridge.request<ExtensionResponse>('runtime.local_tools.execute', {
        toolCallId:
          typeof message.toolCallId === 'string' ? message.toolCallId : '',
        name: typeof message.name === 'string' ? message.name : '',
        args: argsPayload,
      });
    }

    if (type === 'tool_permission_decide') {
      return bridge.request<ExtensionResponse>(
        'runtime.local_tools.permission_decide',
        message.payload ?? {},
      );
    }

    if (type === 'extension_tool_permissions_list') {
      return bridge.request<ExtensionResponse>(
        'runtime.local_tools.permissions.list',
      );
    }

    if (type === 'extension_tool_permissions_upsert') {
      return bridge.request<ExtensionResponse>(
        'runtime.local_tools.permissions.upsert',
        message.payload ?? {},
      );
    }

    if (type === 'extension_tool_permissions_delete') {
      return bridge.request<ExtensionResponse>(
        'runtime.local_tools.permissions.delete',
        message.payload ?? {},
      );
    }

    return {
      ok: false,
      error: `Unsupported runtime message: ${type}`,
    };
  };

  return {
    id: RUNTIME_ID,
    sendMessage,
  };
};

export const VSCODE_LOCAL_TOOLS_RUNTIME_ID = RUNTIME_ID;
