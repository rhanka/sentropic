import { writable } from 'svelte/store';

export type LocalToolName =
  | 'tab_read'
  | 'tab_action'
  | 'tab_read_dom'
  | 'tab_screenshot'
  | 'tab_click'
  | 'tab_type'
  | 'tab_scroll'
  | 'tab_info';

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

const LOCAL_TOOL_DEFINITIONS: ReadonlyArray<LocalToolDefinition> = [
  {
    name: 'tab_read',
    description:
      'Read active-tab data with mode=info|dom|screenshot|elements.',
    parameters: {
      type: 'object',
      properties: {
        mode: {
          type: 'string',
          enum: ['info', 'dom', 'screenshot', 'elements'],
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

const LOCAL_TOOL_NAMES: ReadonlySet<LocalToolName> = new Set([
  'tab_read',
  'tab_action',
  'tab_read_dom',
  'tab_screenshot',
  'tab_click',
  'tab_type',
  'tab_scroll',
  'tab_info',
]);

type RuntimeLike = {
  id?: string;
  sendMessage?: (
    message: unknown,
  ) => Promise<{
    ok?: boolean;
    result?: unknown;
    error?: string;
    permissionRequest?: LocalToolPermissionRequest;
    items?: LocalToolPermissionPolicyEntry[];
    item?: LocalToolPermissionPolicyEntry;
  }>;
};

const getRuntime = (): RuntimeLike | null => {
  const ext = globalThis as typeof globalThis & {
    chrome?: { runtime?: RuntimeLike };
  };
  return ext.chrome?.runtime ?? null;
};

const hasExtensionRuntimeMessaging = (): boolean => {
  const runtime = getRuntime();
  return Boolean(runtime?.id && runtime?.sendMessage);
};

export const isLocalToolName = (name: string): name is LocalToolName =>
  LOCAL_TOOL_NAMES.has(name as LocalToolName);
export const isLocalToolRuntimeAvailable = (): boolean =>
  hasExtensionRuntimeMessaging();

export const getLocalToolDefinitions = (): LocalToolDefinition[] =>
  LOCAL_TOOL_DEFINITIONS.map((tool) => ({ ...tool }));

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

const getRuntimeWithMessaging = (): RuntimeLike => {
  const ext = globalThis as typeof globalThis & {
    chrome?: { runtime?: RuntimeLike };
  };
  const runtime = ext.chrome?.runtime ?? null;
  const sendMessage = runtime?.sendMessage;
  if (!runtime?.id || !sendMessage) {
    throw new Error('Local tool runtime is unavailable outside extension context.');
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
  const sendMessage = runtime.sendMessage as NonNullable<RuntimeLike['sendMessage']>;

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
      const request = response.permissionRequest;
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
  const sendMessage = runtime.sendMessage as NonNullable<RuntimeLike['sendMessage']>;
  const response = await sendMessage({
    type: 'tool_permission_decide',
    payload: {
      requestId,
      decision,
    },
  });
  if (!response?.ok) {
    throw new Error(response?.error ?? 'Unable to save local tool permission decision.');
  }
}

export async function listLocalToolPermissionPolicies(): Promise<
  LocalToolPermissionPolicyEntry[]
> {
  const runtime = getRuntimeWithMessaging();
  const sendMessage = runtime.sendMessage as NonNullable<RuntimeLike['sendMessage']>;
  const response = await sendMessage({
    type: 'extension_tool_permissions_list',
  });
  if (!response?.ok) {
    throw new Error(response?.error ?? 'Unable to load extension tool permissions.');
  }
  return Array.isArray(response.items) ? response.items : [];
}

export async function upsertLocalToolPermissionPolicy(input: {
  toolName: string;
  origin: string;
  policy: LocalToolPermissionPolicy;
}): Promise<LocalToolPermissionPolicyEntry> {
  const runtime = getRuntimeWithMessaging();
  const sendMessage = runtime.sendMessage as NonNullable<RuntimeLike['sendMessage']>;
  const response = await sendMessage({
    type: 'extension_tool_permissions_upsert',
    payload: input,
  });
  if (!response?.ok || !response.item) {
    throw new Error(response?.error ?? 'Unable to update extension tool permission.');
  }
  return response.item;
}

export async function deleteLocalToolPermissionPolicy(input: {
  toolName: string;
  origin: string;
}): Promise<void> {
  const runtime = getRuntimeWithMessaging();
  const sendMessage = runtime.sendMessage as NonNullable<RuntimeLike['sendMessage']>;
  const response = await sendMessage({
    type: 'extension_tool_permissions_delete',
    payload: input,
  });
  if (!response?.ok) {
    throw new Error(response?.error ?? 'Unable to delete extension tool permission.');
  }
}
