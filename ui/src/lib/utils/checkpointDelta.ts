import { parsePendingLocalToolCallsFromStatusPayload } from '$lib/utils/localToolStreamSync';
import { isLocalToolName } from '$lib/stores/localTools';

export type CheckpointSummaryLike = {
  anchorSequence?: number | null;
};

export type CheckpointMessageLike = {
  id: string;
  role: string;
  sequence?: number | null;
  _streamId?: string | null;
};

export type CheckpointStreamEventLike = {
  eventType: string;
  data: unknown;
  sequence: number;
};

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
};

const parseArgsRecord = (argsText: string): Record<string, unknown> | null => {
  const trimmed = argsText.trim();
  if (!trimmed) return null;
  try {
    return asRecord(JSON.parse(trimmed));
  } catch {
    return null;
  }
};

const MUTATING_TOOL_NAME_SUFFIXES = ['_create', '_update', '_delete'];
const READ_ONLY_GIT_ACTIONS = new Set(['status', 'diff', 'ls_files']);
const MUTATING_GIT_ACTIONS = new Set([
  'add',
  'commit',
  'push',
  'reset',
  'checkout',
  'rebase',
  'clean',
]);
const BASH_MUTATION_PATTERNS = [
  /\bapply_patch\b/i,
  /\bmv\b/i,
  /\bcp\b/i,
  /\brm\b/i,
  /\bmkdir\b/i,
  /\btouch\b/i,
  /\bchmod\b/i,
  /\bchown\b/i,
  /\bsed\s+-i\b/i,
  /\bperl\s+-pi\b/i,
  /\bpatch\b/i,
  /\btee\b/i,
  /\bgit\s+(add|commit|push|reset|checkout|rebase|clean)\b/i,
];

const isMutatingGitAction = (argsText: string): boolean => {
  const record = parseArgsRecord(argsText);
  const action = String(record?.action ?? '').trim().toLowerCase();
  if (READ_ONLY_GIT_ACTIONS.has(action)) return false;
  if (MUTATING_GIT_ACTIONS.has(action)) return true;
  return false;
};

const isMutatingBashCommand = (argsText: string): boolean => {
  const record = parseArgsRecord(argsText);
  const command = String(record?.command ?? '').trim();
  if (!command) return false;
  return BASH_MUTATION_PATTERNS.some((pattern) => pattern.test(command));
};

const isMutatingToolCall = (toolName: string, argsText: string): boolean => {
  const normalized = toolName.trim().toLowerCase();
  if (!normalized) return false;
  if (normalized === 'file_edit') return true;
  if (normalized === 'git') return isMutatingGitAction(argsText);
  if (normalized === 'bash') return isMutatingBashCommand(argsText);
  if (normalized === 'plan') return false;
  return MUTATING_TOOL_NAME_SUFFIXES.some((suffix) => normalized.endsWith(suffix));
};

const hasMutatingToolEvent = (
  events: CheckpointStreamEventLike[],
): boolean => {
  const toolCalls = new Map<string, { name: string; argsText: string }>();

  for (const event of events) {
    if (event.eventType === 'tool_call_start') {
      const record = asRecord(event.data);
      const toolCallId = String(record?.tool_call_id ?? '').trim();
      if (!toolCallId) continue;
      const previous = toolCalls.get(toolCallId);
      toolCalls.set(toolCallId, {
        name: String(record?.name ?? previous?.name ?? '').trim(),
        argsText: `${previous?.argsText ?? ''}${String(record?.args ?? '')}`,
      });
      continue;
    }

    if (event.eventType === 'tool_call_delta') {
      const record = asRecord(event.data);
      const toolCallId = String(record?.tool_call_id ?? '').trim();
      if (!toolCallId) continue;
      const previous = toolCalls.get(toolCallId);
      toolCalls.set(toolCallId, {
        name: previous?.name ?? '',
        argsText: `${previous?.argsText ?? ''}${String(record?.delta ?? '')}`,
      });
      continue;
    }

    if (event.eventType === 'status') {
      const pendingCalls = parsePendingLocalToolCallsFromStatusPayload(
        'checkpoint',
        Number(event.sequence ?? 0),
        event.data,
        isLocalToolName,
      );
      for (const call of pendingCalls) {
        toolCalls.set(call.toolCallId, {
          name: call.name,
          argsText: call.argsText,
        });
      }
    }
  }

  for (const toolCall of toolCalls.values()) {
    if (isMutatingToolCall(toolCall.name, toolCall.argsText)) return true;
  }
  return false;
};

export const hasCheckpointMutationDelta = (
  checkpoint: CheckpointSummaryLike | null | undefined,
  messages: CheckpointMessageLike[],
  initialEventsByMessageId: Map<string, CheckpointStreamEventLike[]>,
): boolean => {
  if (!checkpoint) return false;
  const anchorSequence = Number(checkpoint.anchorSequence ?? 0);
  if (!Number.isFinite(anchorSequence) || anchorSequence <= 0) return false;

  const assistantMessagesAfterAnchor = messages.filter((message) => {
    if (message.role !== 'assistant') return false;
    const sequence = Number(message.sequence ?? 0);
    return Number.isFinite(sequence) && sequence > anchorSequence;
  });

  for (const message of assistantMessagesAfterAnchor) {
    const streamId = String(message._streamId ?? message.id ?? '').trim();
    if (!streamId) continue;
    const events = initialEventsByMessageId.get(streamId) ?? [];
    if (events.length === 0) continue;
    if (hasMutatingToolEvent(events)) return true;
  }

  return false;
};
