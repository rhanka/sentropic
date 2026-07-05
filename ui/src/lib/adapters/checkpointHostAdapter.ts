/**
 * checkpointHostAdapter.ts — Sentropic implementation of CheckpointHost.
 *
 * Binds the generic @sentropic/chat-ui/checkpoints module to the sentropic API
 * using session-adapter URL helpers. Keeps all sentropic domain strings here
 * (folderId, useCaseId, organizationId, workspaceId, _create/_update/_delete suffixes)
 * so the package module stays domain-neutral.
 */

import type { CheckpointHost } from '@sentropic/chat-ui/checkpoints';
import { apiGet, apiPost } from '$lib/utils/api';
import { isLocalToolName } from '@sentropic/chat-ui/stores/localTools';
import {
  chatSessionCheckpointsUrl,
  chatSessionCheckpointCreateUrl,
  chatSessionCheckpointRestoreUrl,
} from '$lib/chat/session-adapter';

// Sentropic domain tool name suffix rule: any tool ending with _create, _update,
// or _delete is considered a mutating operation.
const MUTATING_TOOL_NAME_SUFFIXES = ['_create', '_update', '_delete'];

const isSentropicMutatingTool = (toolName: string, _argsText: string): boolean => {
  const normalized = toolName.trim().toLowerCase();
  return MUTATING_TOOL_NAME_SUFFIXES.some((suffix) => normalized.endsWith(suffix));
};

const asRecord = (argsText: string): Record<string, unknown> | null => {
  const trimmed = argsText.trim();
  if (!trimmed) return null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
};

/**
 * Produces a human-readable label for sentropic domain tool calls
 * (those ending in _create/_update/_delete, e.g. folder_create, usecase_update).
 * Returns null for non-domain tools (built-in classifiers handle those).
 */
const humanizeDomainMutationLabel = (
  toolName: string,
  argsText: string,
): string | null => {
  const record = asRecord(argsText);
  const entity = toolName.replace(/_(create|update|delete)$/i, '');
  const label = entity.replace(/_/g, ' ').trim();
  if (!label) return null;
  const idCandidate = String(
    record?.id ??
      record?.folderId ??
      record?.useCaseId ??
      record?.organizationId ??
      record?.workspaceId ??
      '',
  ).trim();
  const action = toolName.split('_').slice(-1)[0];
  return idCandidate ? `${label} ${action}: ${idCandidate}` : `${label} ${action}`;
};

export type SentropicCheckpoint = {
  id: string;
  title: string;
  anchorMessageId: string;
  anchorSequence: number;
  messageCount: number;
  createdAt: string;
};

/**
 * Creates the sentropic CheckpointHost implementation.
 * Pass this to the checkpoint module functions via the opts parameter.
 */
export const createCheckpointHost = (): CheckpointHost<SentropicCheckpoint> => ({
  async fetchCheckpoints(sessionId: string): Promise<SentropicCheckpoint[]> {
    const res = await apiGet<{ checkpoints?: SentropicCheckpoint[] }>(
      chatSessionCheckpointsUrl(sessionId, 20),
    );
    return Array.isArray(res.checkpoints) ? res.checkpoints : [];
  },

  async createCheckpoint(sessionId: string, anchorMessageId: string): Promise<void> {
    await apiPost(chatSessionCheckpointCreateUrl(sessionId), { anchorMessageId });
  },

  async restoreCheckpoint(sessionId: string, checkpointId: string): Promise<void> {
    await apiPost(chatSessionCheckpointRestoreUrl(sessionId, checkpointId), {});
  },

  isMutatingTool: isSentropicMutatingTool,

  // Wire the sentropic local tool name guard so status-event tool calls
  // (pending_local_tool_calls) are included in the mutation scan.
  isLocalToolName,

  humanizeMutation: humanizeDomainMutationLabel,
});
