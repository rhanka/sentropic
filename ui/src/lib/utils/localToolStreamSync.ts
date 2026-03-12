export type NormalizedPendingLocalToolCall = {
  toolCallId: string;
  name: string;
  argsText: string;
  streamId: string;
  sequence: number;
};

type LocalToolNameGuard = (value: string) => boolean;

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
};

const serializeArgs = (value: unknown): string => {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value ?? {});
  } catch {
    return '{}';
  }
};

export const parsePendingLocalToolCallsFromStatusPayload = (
  streamId: string,
  sequence: number,
  data: unknown,
  isLocalToolName: LocalToolNameGuard,
): NormalizedPendingLocalToolCall[] => {
  const record = asRecord(data);
  if (!record) return [];
  if (String(record.state ?? '').trim() !== 'awaiting_local_tool_results') {
    return [];
  }
  const pendingRaw = Array.isArray(record.pending_local_tool_calls)
    ? record.pending_local_tool_calls
    : [];
  const seen = new Set<string>();
  const calls: NormalizedPendingLocalToolCall[] = [];
  for (const item of pendingRaw) {
    const entry = asRecord(item);
    const toolCallId =
      entry && typeof entry.tool_call_id === 'string'
        ? entry.tool_call_id.trim()
        : '';
    const name =
      entry && typeof entry.name === 'string' ? entry.name.trim() : '';
    if (!toolCallId || seen.has(toolCallId) || !isLocalToolName(name)) continue;
    seen.add(toolCallId);
    calls.push({
      toolCallId,
      name,
      argsText: serializeArgs(entry?.args),
      streamId,
      sequence,
    });
  }
  return calls;
};

export type PermissionPromptShape = {
  toolCallId: string;
  streamId: string;
};

export const shouldResetLocalToolStateForFreshRound = (
  previous:
    | {
        executed: boolean;
        lastSequence: number;
      }
    | null
    | undefined,
  sequence: number,
): boolean =>
  Boolean(previous) &&
  Boolean(previous?.executed) &&
  Number.isFinite(sequence) &&
  sequence > (previous?.lastSequence ?? 0);

export const filterPermissionPromptsForPendingStream = <T extends PermissionPromptShape>(
  prompts: T[],
  streamId: string,
  pendingToolCallIds: Set<string>,
): T[] =>
  prompts.filter((prompt) => {
    if (prompt.streamId !== streamId) return true;
    return pendingToolCallIds.has(prompt.toolCallId);
  });
