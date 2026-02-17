import { writable } from 'svelte/store';

export type LocalToolName =
  | 'tab_read_dom'
  | 'tab_screenshot'
  | 'tab_click'
  | 'tab_type'
  | 'tab_scroll'
  | 'tab_info';

export type LocalToolExecutionStatus =
  | 'pending'
  | 'executing'
  | 'completed'
  | 'failed';

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
  updatedAt: number;
};

type LocalToolsState = {
  available: boolean;
  tools: LocalToolDefinition[];
  executions: Record<string, LocalToolExecution>;
};

const LOCAL_TOOL_DEFINITIONS: ReadonlyArray<LocalToolDefinition> = [
  {
    name: 'tab_read_dom',
    description:
      'Read the text content of the active tab, optionally constrained by CSS selector.',
    parameters: {
      type: 'object',
      properties: {
        selector: { type: 'string' },
        includeHtml: { type: 'boolean' },
      },
      required: [],
    },
  },
  {
    name: 'tab_screenshot',
    description: 'Capture the visible area of the active tab as a JPEG image.',
    parameters: {
      type: 'object',
      properties: {
        quality: { type: 'integer', minimum: 1, maximum: 100 },
      },
      required: [],
    },
  },
  {
    name: 'tab_click',
    description:
      'Click an element in the active tab by selector or coordinates.',
    parameters: {
      type: 'object',
      properties: {
        selector: { type: 'string' },
        x: { type: 'number' },
        y: { type: 'number' },
      },
      required: [],
    },
  },
  {
    name: 'tab_type',
    description:
      'Type text into an input or textarea element selected with a CSS selector.',
    parameters: {
      type: 'object',
      properties: {
        selector: { type: 'string' },
        text: { type: 'string' },
        clear: { type: 'boolean' },
      },
      required: ['selector', 'text'],
    },
  },
  {
    name: 'tab_scroll',
    description: 'Scroll the active page or a specific scrollable container.',
    parameters: {
      type: 'object',
      properties: {
        direction: { type: 'string', enum: ['up', 'down', 'top', 'bottom'] },
        pixels: { type: 'integer' },
        selector: { type: 'string' },
      },
      required: ['direction'],
    },
  },
  {
    name: 'tab_info',
    description: 'Return metadata about the active page (URL/title/headings).',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
];

const LOCAL_TOOL_NAMES: ReadonlySet<LocalToolName> = new Set([
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
  ) => Promise<{ ok?: boolean; result?: unknown; error?: string }>;
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

export async function executeLocalTool(
  toolCallId: string,
  name: LocalToolName,
  args: unknown,
  options?: ExecuteLocalToolOptions,
): Promise<unknown> {
  const ext = globalThis as typeof globalThis & {
    chrome?: { runtime?: RuntimeLike };
  };
  const runtime = ext.chrome?.runtime ?? null;
  const sendMessage = runtime?.sendMessage;
  if (!runtime?.id || !sendMessage) {
    throw new Error('Local tool runtime is unavailable outside extension context.');
  }

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
      error: undefined,
    });
    return response.result;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    upsertExecution(toolCallId, {
      name,
      args,
      streamId: options?.streamId,
      status: 'failed',
      error: reason,
    });
    throw error;
  }
}
