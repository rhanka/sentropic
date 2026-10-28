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
