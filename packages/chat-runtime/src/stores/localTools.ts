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

import type { LocalToolsAdapter } from '../hosts/types.js';

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
);

/**
 * Host-registered local tools, keyed by normalized tool name. Additive to the
 * built-in Chrome/VSCode sets — a host registers its own tool (e.g.
 * `render_mermaid`) so the controller recognizes it as local and
 * `getLocalToolDefinitions` advertises it to the model.
 *
 * SCOPE: module-level singleton (process/module scoped), consistent with the
 * sibling `setLocalToolsAdapter` and `localToolsStore` seams in this file.
 * Multiple chat instances on one page share it. Under SSR or in tests, call
 * `clearRegisteredLocalTools()` to reset between requests/cases.
 *
 * COLLISION: registration affects RECOGNITION + advertised DEFINITIONS only —
 * never transport. Actually executing a tool still depends on the
 * host-injected executor (`attachLocalToolMachine` / `setLocalToolsAdapter`).
 * A registered definition for a built-in name overrides that built-in's
 * advertised definition (dedupe by name in `getLocalToolDefinitions`), but
 * built-in recognition cannot be removed via the registry.
 *
 * Insertion order is preserved for deterministic definition ordering.
 */
const registeredLocalTools = new Map<string, LocalToolDefinition>();

/**
 * Normalize a local tool name for registry keying. Trims surrounding
 * whitespace only — names are case-sensitive (built-ins are lower_snake_case
 * and matched exactly against the raw stream tool name).
 */
const normalizeLocalToolName = (name: unknown): string =>
  String(name ?? '').trim();

/**
 * Register a host-provided local tool. Its `name` becomes a recognized local
 * tool name (`isLocalToolName(name) === true`) and its definition is appended
 * to `getLocalToolDefinitions()`. Re-registering the same name overwrites the
 * previous definition. Does NOT shadow built-ins for recognition, but a
 * registered definition for a built-in name overrides that built-in's
 * advertised definition.
 */
export const registerLocalTool = (definition: LocalToolDefinition): void => {
  const name = normalizeLocalToolName(definition?.name);
  if (!name) {
    throw new TypeError('registerLocalTool requires a non-empty tool name.');
  }
  registeredLocalTools.set(name, { ...definition, name });
};

/** Register multiple host-provided local tools in one call. */
export const registerLocalTools = (
  definitions: ReadonlyArray<LocalToolDefinition>,
): void => {
  for (const definition of definitions) registerLocalTool(definition);
};

/**
 * Remove a previously host-registered local tool. Built-in names are never
 * affected (this only clears the host registry entry). Returns true if a
 * registered entry was removed.
 */
export const unregisterLocalTool = (name: string): boolean =>
  registeredLocalTools.delete(normalizeLocalToolName(name));

/** Clear all host-registered local tools. Built-ins are untouched. */
export const clearRegisteredLocalTools = (): void => {
  registeredLocalTools.clear();
};

/** Snapshot of the host-registered local tool definitions (registration order). */
export const listRegisteredLocalTools = (): LocalToolDefinition[] =>
  [...registeredLocalTools.values()].map((tool) => ({ ...tool }));

let injectedAdapter: LocalToolsAdapter | null = null;

/**
 * Inject a custom local-tools host adapter. Pass `null` to clear the
 * injected adapter and fall back to the default `globalThis.chrome.runtime`
 * lookup. Used by tests and embedded hosts.
 */
export const setLocalToolsAdapter = (
  adapter: LocalToolsAdapter | null,
): void => {
  injectedAdapter = adapter;
};

const getRuntime = (): LocalToolsAdapter | null => {
  if (injectedAdapter) return injectedAdapter;
  const ext = globalThis as typeof globalThis & {
    chrome?: { runtime?: LocalToolsAdapter };
  };
  return ext.chrome?.runtime ?? null;
};

const isVsCodeRuntime = (runtime: LocalToolsAdapter | null): boolean => {
  const runtimeId = String(runtime?.id ?? '').trim().toLowerCase();
  return runtimeId === 'sentropic.vscode.runtime';
};

const hasExtensionRuntimeMessaging = (): boolean => {
  const runtime = getRuntime();
  return Boolean(runtime?.id && runtime?.sendMessage);
};

/**
 * True when `name` is a recognized local tool: either a sentropic built-in or
 * a host-registered tool name. The widened return type matches the open
 * `LocalToolName`. This is the store-level guard the controller consults via
 * the host-injected `isLocalToolName` hook of `attachLocalToolMachine`.
 */
export const isLocalToolName = (name: string): name is LocalToolName =>
  BUILTIN_LOCAL_TOOL_NAME_SET.has(name) || registeredLocalTools.has(name);
export const isLocalToolRuntimeAvailable = (): boolean =>
  hasExtensionRuntimeMessaging();

const getRuntimeToolDefinitions = (
  runtime: LocalToolsAdapter | null,
): ReadonlyArray<LocalToolDefinition> =>
  isVsCodeRuntime(runtime)
    ? VSCODE_LOCAL_TOOL_DEFINITIONS
    : CHROME_LOCAL_TOOL_DEFINITIONS;

/**
 * Built-in runtime definitions (Chrome or VSCode, per the active adapter) plus
 * any host-registered definitions. A host-registered definition for a built-in
 * name overrides that built-in's advertised entry (deduplicated by name).
 */
export const getLocalToolDefinitions = (): LocalToolDefinition[] => {
  const byName = new Map<string, LocalToolDefinition>();
  for (const tool of getRuntimeToolDefinitions(getRuntime())) {
    byName.set(tool.name, { ...tool });
  }
  for (const tool of registeredLocalTools.values()) {
    byName.set(tool.name, { ...tool });
  }
  return [...byName.values()];
};

const now = () => Date.now();

export const localToolsStore = writable<LocalToolsState>({
  available: hasExtensionRuntimeMessaging(),
  tools: getLocalToolDefinitions(),
  executions: {},
});

const upsertExecution = (
  toolCallId: string,
  patch: Partial<LocalToolExecution> & Pick<LocalToolExecution, 'name' | 'args'>,
) => {
  localToolsStore.update((state) => {
    const runtime = getRuntime();
    const current = state.executions[toolCallId];
    const next: LocalToolExecution = {
      toolCallId,
      name: patch.name,
      args: patch.args,
      status: patch.status ?? current?.status ?? 'pending',
      result: patch.result ?? current?.result,
      error: patch.error ?? current?.error,
      permissionRequest: patch.permissionRequest ?? current?.permissionRequest,
      streamId: patch.streamId ?? current?.streamId,
      updatedAt: now(),
    };
    return {
      ...state,
      available: hasExtensionRuntimeMessaging(),
      tools: getRuntimeToolDefinitions(runtime).map((tool) => ({ ...tool })),
      executions: {
        ...state.executions,
        [toolCallId]: next,
      },
    };
  });
};

type ExecuteLocalToolOptions = {
  streamId?: string;
};

const getRuntimeWithMessaging = (): LocalToolsAdapter => {
  const runtime = getRuntime();
  const sendMessage = runtime?.sendMessage;
  if (!runtime?.id || !sendMessage) {
    throw new Error(
      'Local tool runtime is unavailable outside extension context.',
    );
  }
  return runtime;
};

export async function executeLocalTool(
  toolCallId: string,
  name: LocalToolName,
  args: unknown,
  options?: ExecuteLocalToolOptions,
): Promise<unknown> {
  const runtime = getRuntimeWithMessaging();
  const sendMessage = runtime.sendMessage as NonNullable<
    LocalToolsAdapter['sendMessage']
  >;

  upsertExecution(toolCallId, {
    name,
    args,
    streamId: options?.streamId,
    status: 'executing',
    error: undefined,
  });

  try {
    const response = await sendMessage({
      type: 'tool_execute',
      toolCallId,
      name,
      args,
    });

    if (response?.permissionRequest) {
      const request = response.permissionRequest as LocalToolPermissionRequest;
      upsertExecution(toolCallId, {
        name,
        args,
        streamId: options?.streamId,
        status: 'awaiting_permission',
        permissionRequest: request,
        error: undefined,
      });
      throw new LocalToolPermissionRequiredError(request);
    }

    if (!response?.ok) {
      const reason = response?.error ?? 'Local tool execution failed.';
      upsertExecution(toolCallId, {
        name,
        args,
        streamId: options?.streamId,
        status: 'failed',
        error: reason,
      });
      throw new Error(reason);
    }

    upsertExecution(toolCallId, {
      name,
      args,
      streamId: options?.streamId,
      status: 'completed',
      result: response.result,
      permissionRequest: undefined,
      error: undefined,
    });
    return response.result;
  } catch (error) {
    if (error instanceof LocalToolPermissionRequiredError) {
      throw error;
    }
    const reason = error instanceof Error ? error.message : String(error);
    upsertExecution(toolCallId, {
      name,
      args,
      streamId: options?.streamId,
      status: 'failed',
      permissionRequest: undefined,
      error: reason,
    });
    throw error;
  }
}

export async function decideLocalToolPermission(
  requestId: string,
  decision: LocalToolPermissionDecision,
): Promise<void> {
  const runtime = getRuntimeWithMessaging();
  const sendMessage = runtime.sendMessage as NonNullable<
    LocalToolsAdapter['sendMessage']
  >;
  const response = await sendMessage({
    type: 'tool_permission_decide',
    payload: {
      requestId,
      decision,
    },
  });
  if (!response?.ok) {
    throw new Error(
      response?.error ?? 'Unable to save local tool permission decision.',
    );
  }
}

export async function listLocalToolPermissionPolicies(): Promise<
  LocalToolPermissionPolicyEntry[]
> {
  const runtime = getRuntimeWithMessaging();
  const sendMessage = runtime.sendMessage as NonNullable<
    LocalToolsAdapter['sendMessage']
  >;
  const response = await sendMessage({
    type: 'extension_tool_permissions_list',
  });
  if (!response?.ok) {
    throw new Error(
      response?.error ?? 'Unable to load extension tool permissions.',
    );
  }
  return Array.isArray(response.items)
    ? (response.items as LocalToolPermissionPolicyEntry[])
    : [];
}

export async function upsertLocalToolPermissionPolicy(input: {
  toolName: string;
  origin: string;
  policy: LocalToolPermissionPolicy;
  pathPattern?: string;
}): Promise<LocalToolPermissionPolicyEntry> {
  const runtime = getRuntimeWithMessaging();
  const sendMessage = runtime.sendMessage as NonNullable<
    LocalToolsAdapter['sendMessage']
  >;
  const response = await sendMessage({
    type: 'extension_tool_permissions_upsert',
    payload: input,
  });
  if (!response?.ok || !response.item) {
    throw new Error(
      response?.error ?? 'Unable to update extension tool permission.',
    );
  }
  return response.item as LocalToolPermissionPolicyEntry;
}

export async function deleteLocalToolPermissionPolicy(input: {
  toolName: string;
  origin: string;
  pathPattern?: string;
}): Promise<void> {
  const runtime = getRuntimeWithMessaging();
  const sendMessage = runtime.sendMessage as NonNullable<
    LocalToolsAdapter['sendMessage']
  >;
  const response = await sendMessage({
    type: 'extension_tool_permissions_delete',
    payload: input,
  });
  if (!response?.ok) {
    throw new Error(
      response?.error ?? 'Unable to delete extension tool permission.',
    );
  }
}
