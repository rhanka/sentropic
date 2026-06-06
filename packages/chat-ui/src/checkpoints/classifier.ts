/**
 * classifier.ts — Generic checkpoint mutation classifier.
 *
 * Pure TypeScript, zero sentropic domain strings.
 * Sentropic-specific logic (MUTATING_TOOL_NAME_SUFFIXES, humanizeDomainMutationLabel,
 * isLocalToolName from stores) lives in ui/src/lib/adapters/checkpointHostAdapter.ts.
 *
 * The `opts.isMutatingTool` hook lets hosts declare additional tool names as mutating
 * (e.g. custom API tools with _create/_update/_delete suffixes).
 *
 * The `opts.isLocalToolName` hook lets hosts declare which tool names are "local"
 * so that status-event tool calls can be included in the mutation scan.
 * Defaults to `() => false` — correct for environments with no local tools (no
 * local tool calls will appear in status events, so filtering all is equivalent).
 *
 * The `opts.humanizeMutation` hook lets hosts produce human-readable mutation labels
 * for tool calls that are not git/bash/file_edit.
 */

import { parsePendingLocalToolCallsFromStatusPayload } from '../utils/localToolStreamSync.js';

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

/**
 * Generic built-in classifier. Returns true for git mutations, bash mutations,
 * and file_edit. The `isMutatingTool` hook can extend this for custom tools.
 */
const isBuiltinMutatingToolCall = (toolName: string, argsText: string): boolean => {
  const normalized = toolName.trim().toLowerCase();
  if (!normalized) return false;
  if (normalized === 'file_edit') return true;
  if (normalized === 'git') return isMutatingGitAction(argsText);
  if (normalized === 'bash') return isMutatingBashCommand(argsText);
  if (normalized === 'plan') return false;
  return false;
};

type ParsedToolCall = {
  name: string;
  argsText: string;
};

type ClassifierOpts = {
  /** Returns true if the named tool is a mutating operation. Called after built-in classifiers. */
  isMutatingTool?: (toolName: string, argsText: string) => boolean;
  /**
   * Returns true if toolName is a "local" tool (so it can be included from status events).
   * Default: `() => false` — correct when no local tools exist in the host environment.
   */
  isLocalToolName?: (name: string) => boolean;
  /** Returns a human-readable label for a mutating tool call (for preview). */
  humanizeMutation?: (toolName: string, argsText: string) => string | null;
};

const DEFAULT_IS_LOCAL_TOOL_NAME = (_name: string): boolean => false;

const isMutatingToolCall = (
  toolName: string,
  argsText: string,
  opts?: ClassifierOpts,
): boolean => {
  if (isBuiltinMutatingToolCall(toolName, argsText)) return true;
  if (opts?.isMutatingTool) return opts.isMutatingTool(toolName, argsText);
  return false;
};

const collectToolCallsFromEvents = (
  events: CheckpointStreamEventLike[],
  isLocalToolName: (name: string) => boolean,
): ParsedToolCall[] => {
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

  return [...toolCalls.values()].filter((tc) => tc.name.trim().length > 0);
};

const getGitMutationPreviewItems = (argsText: string): string[] => {
  const record = parseArgsRecord(argsText);
  const action = String(record?.action ?? '').trim().toLowerCase();
  if (!action || READ_ONLY_GIT_ACTIONS.has(action)) return [];
  const paths = Array.isArray(record?.paths)
    ? record.paths.map((value) => String(value ?? '').trim()).filter(Boolean)
    : [];
  const path = String(record?.path ?? '').trim();
  const labels = [...paths, ...(path ? [path] : [])];
  if (labels.length > 0) {
    return labels.map((value) => `git ${action}: ${value}`);
  }
  return [`git ${action}`];
};

const getBashMutationPreviewItems = (argsText: string): string[] => {
  const record = parseArgsRecord(argsText);
  const command = String(record?.command ?? '').trim();
  if (!command || !isMutatingBashCommand(argsText)) return [];
  const normalized = command.replace(/\s+/g, ' ');
  const pathMatch =
    normalized.match(/\b(?:mv|cp|rm|mkdir|touch|chmod|chown)\s+([^\s]+)/i) ??
    normalized.match(/\bsed\s+-i(?:\s+['"][^'"]*['"])?\s+([^\s]+)/i);
  if (pathMatch?.[1]) {
    return [pathMatch[1]];
  }
  return [normalized.length > 72 ? `${normalized.slice(0, 69)}...` : normalized];
};

const getToolCallPreviewItems = (
  toolName: string,
  argsText: string,
  opts?: ClassifierOpts,
): string[] => {
  const normalized = toolName.trim().toLowerCase();
  if (!isMutatingToolCall(normalized, argsText, opts)) return [];
  if (normalized === 'file_edit') {
    const record = parseArgsRecord(argsText);
    const path = String(record?.path ?? '').trim();
    return path ? [path] : ['file edit'];
  }
  if (normalized === 'git') return getGitMutationPreviewItems(argsText);
  if (normalized === 'bash') return getBashMutationPreviewItems(argsText);
  if (opts?.humanizeMutation) {
    const label = opts.humanizeMutation(normalized, argsText);
    if (label) return [label];
  }
  return [normalized.replace(/_/g, ' ')];
};

/**
 * Returns true if the checkpoint covers assistant messages that contain mutating
 * tool calls (git commit, bash rm, file_edit, or host-custom mutating tools).
 *
 * @param checkpoint - The checkpoint to test (must have anchorSequence > 0).
 * @param messages - Full message list for the session.
 * @param initialEventsByMessageId - Stream events keyed by message id / streamId.
 * @param opts - Optional host hooks: isMutatingTool, isLocalToolName, humanizeMutation.
 */
export const hasCheckpointMutationDelta = (
  checkpoint: CheckpointSummaryLike | null | undefined,
  messages: CheckpointMessageLike[],
  initialEventsByMessageId: Map<string, CheckpointStreamEventLike[]>,
  opts?: ClassifierOpts,
): boolean => {
  if (!checkpoint) return false;
  const anchorSequence = Number(checkpoint.anchorSequence ?? 0);
  if (!Number.isFinite(anchorSequence) || anchorSequence <= 0) return false;

  const isLocal = opts?.isLocalToolName ?? DEFAULT_IS_LOCAL_TOOL_NAME;

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
    for (const toolCall of collectToolCallsFromEvents(events, isLocal)) {
      if (isMutatingToolCall(toolCall.name, toolCall.argsText, opts)) return true;
    }
  }

  return false;
};

/**
 * Returns a deduplicated list (up to 8) of human-readable mutation preview items
 * for a checkpoint — for use in tooltip/title rendering.
 */
export const getCheckpointMutationPreviewItems = (
  checkpoint: CheckpointSummaryLike | null | undefined,
  messages: CheckpointMessageLike[],
  initialEventsByMessageId: Map<string, CheckpointStreamEventLike[]>,
  opts?: ClassifierOpts,
): string[] => {
  if (!checkpoint) return [];
  const anchorSequence = Number(checkpoint.anchorSequence ?? 0);
  if (!Number.isFinite(anchorSequence) || anchorSequence <= 0) return [];

  const isLocal = opts?.isLocalToolName ?? DEFAULT_IS_LOCAL_TOOL_NAME;
  const items = new Set<string>();

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
    for (const toolCall of collectToolCallsFromEvents(events, isLocal)) {
      for (const item of getToolCallPreviewItems(toolCall.name, toolCall.argsText, opts)) {
        items.add(item);
        if (items.size >= 8) return [...items];
      }
    }
  }

  return [...items];
};
