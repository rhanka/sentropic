export type TodoRuntimeRunState = {
  runId: string | null;
  runStatus: string | null;
  runTaskId: string | null;
};

export type TodoRuntimeSteerFeedback = {
  runId: string;
  status: string;
  message: string;
  metadata: Record<string, unknown>;
  submittedAtMs: number;
};

type TodoRuntimeSteerApi = {
  runId?: string | null;
  status?: string | null;
  steer?: {
    message?: string | null;
    metadata?: Record<string, unknown> | null;
  } | null;
};

type ApiPostLike = <T = unknown>(endpoint: string, body?: unknown) => Promise<T>;

const TERMINAL_RUN_STATUSES = new Set(['completed', 'failed', 'cancelled']);

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
};

const asString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
};

export const normalizeTodoRuntimeRunState = (
  runtimeLike: unknown,
  previous?: TodoRuntimeRunState,
): TodoRuntimeRunState => {
  const runtime = asRecord(runtimeLike);
  const activeRun = asRecord(runtime?.activeRun) ?? asRecord(runtime?.run);

  const runId =
    asString(runtime?.runId) ??
    asString(activeRun?.runId) ??
    asString(activeRun?.id) ??
    previous?.runId ??
    null;
  const runStatus =
    asString(runtime?.runStatus) ??
    asString(activeRun?.status) ??
    previous?.runStatus ??
    null;
  const runTaskId =
    asString(runtime?.runTaskId) ??
    asString(activeRun?.taskId) ??
    previous?.runTaskId ??
    null;

  if (!runId) {
    return {
      runId: null,
      runStatus: null,
      runTaskId: null,
    };
  }

  return {
    runId,
    runStatus,
    runTaskId,
  };
};

export const isTodoRuntimeRunSteerable = (run: TodoRuntimeRunState): boolean => {
  if (!run.runId) return false;
  if (!run.runStatus) return true;
  return !TERMINAL_RUN_STATUSES.has(run.runStatus);
};

export const postTodoRuntimeSteer = async (
  apiPost: ApiPostLike,
  runId: string,
  message: string,
): Promise<TodoRuntimeSteerFeedback> => {
  const normalizedRunId = runId.trim();
  const normalizedMessage = message.trim();
  if (!normalizedRunId) {
    throw new Error('Missing run id');
  }
  if (!normalizedMessage) {
    throw new Error('Missing steer message');
  }

  const response = (await apiPost<TodoRuntimeSteerApi>(
    `/runs/${encodeURIComponent(normalizedRunId)}/steer`,
    {
      message: normalizedMessage,
    },
  )) as TodoRuntimeSteerApi;

  const responseSteer = asRecord(response?.steer);
  const responseMetadata = asRecord(responseSteer?.metadata) ?? {};

  return {
    runId: asString(response?.runId) ?? normalizedRunId,
    status: asString(response?.status) ?? 'unknown',
    message: asString(responseSteer?.message) ?? normalizedMessage,
    metadata: responseMetadata,
    submittedAtMs: Date.now(),
  };
};
