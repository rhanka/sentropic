/**
 * BR14a Lot 5 — @sentropic/chat-ui local tools store.
 *
 * UI-generic core for local-tool availability, definitions, executions,
 * permission prompts, and policy operations. Host-specific transport is
 * supplied through a `LocalToolsAdapter` (see `../hosts/types.ts`).
 *
 * Default adapter reads `globalThis.chrome.runtime`, which is satisfied
 * by:
 * - Chrome extension content/side-panel context (native).
 * - VSCode webview context (`installExtensionRuntimeShim` in
 *   `ui/vscode-ext/webview-entry.ts` installs a `chrome.runtime` shim
 *   bridging messages through the host).
 *
 * Hosts that cannot rely on `globalThis.chrome` (tests, future embedded
 * hosts) may inject their own adapter via `setLocalToolsAdapter`.
 *
 * Public re-exports (BR14a Lot 5):
 * - `LocalToolName`, `LocalToolDefinition`, `LocalToolExecution`,
 *   `LocalToolExecutionStatus`, `LocalToolPermissionPolicy`,
 *   `LocalToolPermissionDecision`, `LocalToolPermissionRequest`,
 *   `LocalToolPermissionPolicyEntry`.
 * - `localToolsStore`, `getLocalToolDefinitions`,
 *   `isLocalToolName`, `isLocalToolRuntimeAvailable`.
 * - `executeLocalTool`, `decideLocalToolPermission`,
 *   `listLocalToolPermissionPolicies`, `upsertLocalToolPermissionPolicy`,
 *   `deleteLocalToolPermissionPolicy`.
 * - `LocalToolPermissionRequiredError`, `setLocalToolsAdapter`.
 *
 * Host-extensible registration (open local-tool seam):
 * - `BUILTIN_LOCAL_TOOL_NAMES` — the closed set of sentropic-shipped tool names.
 * - `registerLocalTool`, `registerLocalTools`, `unregisterLocalTool`,
 *   `clearRegisteredLocalTools`, `listRegisteredLocalTools` — let an external
 *   host (Diag, OpenERP, mermaid-editor) register its own tool name + definition
 *   so `isLocalToolName` recognizes it and `getLocalToolDefinitions` advertises
 *   it, without editing this package's enum. The executor stays host-injected
 *   through `attachLocalToolMachine` / `setLocalToolsAdapter`.
 */
import { writable } from 'svelte/store';

import type { LocalToolsAdapter } from '@sentropic/chat-runtime/hosts/types';

/**
 * Closed set of local tool names shipped by sentropic (Chrome tab tools +
 * VSCode workspace tools). External hosts widen the recognized set at runtime
 * via `registerLocalTool` — they do NOT edit this list.
 */
export const BUILTIN_LOCAL_TOOL_NAMES = [
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
] as const;

/**
 * Open local-tool name type. Known built-ins keep IDE autocompletion; the
 * `(string & {})` member accepts any host-registered tool name (e.g.
 * `render_mermaid`). Mirrors `StreamHubEventType` in `client/streamTypes.ts`.
 *
 * Evolution note: additive at runtime, type-widening at compile time. The 16
 * built-ins keep working identically; the only compile-time impact is that
 * `never`-exhaustiveness over `LocalToolName` no longer narrows (the open
 * member is intentional for the host-extension seam).
 */
export type LocalToolName = (typeof BUILTIN_LOCAL_TOOL_NAMES)[number] | (string & {});

export type LocalToolExecutionStatus =
  | 'pending'
  | 'executing'
  | 'awaiting_permission'
  | 'completed'
  | 'failed';

export type LocalToolPermissionDecision =
  | 'allow_once'
  | 'deny_once'
  | 'allow_always'
  | 'deny_always';

export type LocalToolPermissionPolicy = 'allow' | 'deny';

export type LocalToolPermissionRequest = {
  requestId: string;
  toolName: string;
  origin: string;
  tabId?: number;
  tabUrl?: string;
  tabTitle?: string;
  details?: Record<string, unknown>;
};

export type LocalToolDefinition = {
  name: LocalToolName;
  description: string;
  parameters: Record<string, unknown>;
};

export type LocalToolExecution = {
  toolCallId: string;
  streamId?: string;
  name: LocalToolName;
  args: unknown;
  status: LocalToolExecutionStatus;
  result?: unknown;
  error?: string;
  permissionRequest?: LocalToolPermissionRequest;
  updatedAt: number;
};

export type LocalToolPermissionPolicyEntry = {
  toolName: string;
  origin: string;
  policy: LocalToolPermissionPolicy;
  pathPattern?: string | null;
  updatedAt: string;
};

export class LocalToolPermissionRequiredError extends Error {
  request: LocalToolPermissionRequest;

  constructor(request: LocalToolPermissionRequest) {
    super('Local tool execution requires explicit user permission.');
    this.name = 'LocalToolPermissionRequiredError';
    this.request = request;
  }
}

type LocalToolsState = {
  available: boolean;
  tools: LocalToolDefinition[];
  executions: Record<string, LocalToolExecution>;
};

const CHROME_LOCAL_TOOL_DEFINITIONS: ReadonlyArray<LocalToolDefinition> = [
  {
    name: 'tab_read',
    description:
      'Read active-tab data with mode=info|dom|screenshot|elements (screenshot defaults to PNG for readability).',
    parameters: {
      type: 'object',
      properties: {
        mode: {
          type: 'string',
          enum: ['info', 'dom', 'screenshot', 'elements'],
        },
        format: {
          type: 'string',
          enum: ['png', 'jpeg'],
        },
        selector: { type: 'string' },
        includeHtml: { type: 'boolean' },
        quality: { type: 'integer', minimum: 1, maximum: 100 },
        maxElements: { type: 'integer', minimum: 1, maximum: 500 },
      },
      required: ['mode'],
    },
  },
  {
    name: 'tab_action',
    description: 'Execute one or multiple tab actions (scroll|click|type|wait).',
    parameters: {
      type: 'object',
      properties: {
        timeoutMs: { type: 'integer', minimum: 1000, maximum: 120000 },
        action: {
          type: 'string',
          enum: ['scroll', 'click', 'type', 'wait'],
        },
        waitMs: { type: 'integer', minimum: 0, maximum: 60000 },
        direction: { type: 'string', enum: ['up', 'down', 'top', 'bottom'] },
        pixels: { type: 'integer', minimum: 1, maximum: 20000 },
        selector: { type: 'string' },
        text: { type: 'string' },
        exact: { type: 'boolean' },
        clear: { type: 'boolean' },
        x: { type: 'number' },
        y: { type: 'number' },
        actions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              action: {
                type: 'string',
                enum: ['scroll', 'click', 'type', 'wait'],
              },
              waitMs: { type: 'integer', minimum: 0, maximum: 60000 },
              direction: {
                type: 'string',
                enum: ['up', 'down', 'top', 'bottom'],
              },
              pixels: { type: 'integer', minimum: 1, maximum: 20000 },
              selector: { type: 'string' },
              text: { type: 'string' },
              exact: { type: 'boolean' },
              clear: { type: 'boolean' },
              x: { type: 'number' },
              y: { type: 'number' },
            },
            required: ['action'],
          },
        },
      },
      required: [],
    },
  },
];

const VSCODE_LOCAL_TOOL_DEFINITIONS: ReadonlyArray<LocalToolDefinition> = [
  {
    name: 'bash',
    description:
      'Execute a shell command in the current workspace with permission policy checks.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string' },
        timeoutMs: { type: 'integer', minimum: 1000, maximum: 60000 },
      },
      required: ['command'],
    },
  },
  {
    name: 'ls',
    description:
      'List files and directories in the workspace with bounded recursion depth.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        depth: { type: 'integer', minimum: 0, maximum: 4 },
        includeHidden: { type: 'boolean' },
      },
      required: [],
    },
  },
  {
    name: 'rg',
    description:
      'Search text in workspace files via ripgrep with bounded results.',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string' },
        path: { type: 'string' },
        maxResults: { type: 'integer', minimum: 1, maximum: 400 },
        offset: { type: 'integer', minimum: 0, maximum: 2000 },
        timeoutMs: { type: 'integer', minimum: 1000, maximum: 30000 },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'file_read',
    description:
      'Read file content with bounded line-window mode by default.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        startLine: { type: 'integer', minimum: 1 },
        lineCount: { type: 'integer', minimum: 1, maximum: 500 },
        full: { type: 'boolean' },
      },
      required: ['path'],
    },
  },
  {
    name: 'file_edit',
    description:
      'Edit files with mode=write|edit|apply_patch under explicit permission policies.',
    parameters: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['write', 'edit', 'apply_patch'] },
        path: { type: 'string' },
        patch: { type: 'string' },
        content: { type: 'string' },
        find: { type: 'string' },
        replace: { type: 'string' },
        replaceAll: { type: 'boolean' },
      },
      required: ['mode'],
    },
  },
  {
    name: 'git',
    description:
      'Run git actions (status, diff, ls_files, add, commit, push, reset, checkout, rebase, clean) with policy gating.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: [
            'status',
            'diff',
            'ls_files',
            'add',
            'commit',
            'push',
            'reset',
            'checkout',
            'rebase',
            'clean',
          ],
        },
        ref: { type: 'string' },
        path: { type: 'string' },
        paths: { type: 'array', items: { type: 'string' } },
        message: { type: 'string' },
        remote: { type: 'string' },
        branch: { type: 'string' },
        target: { type: 'string' },
        mode: { type: 'string' },
        flags: { type: 'string' },
        cwd: { type: 'string' },
        forceWithLease: { type: 'boolean' },
        noVerify: { type: 'boolean' },
        timeoutMs: { type: 'integer', minimum: 1000, maximum: 30000 },
      },
      required: [],
    },
  },
];

const BUILTIN_LOCAL_TOOL_NAME_SET: ReadonlySet<string> = new Set<string>(
  BUILTIN_LOCAL_TOOL_NAMES,
