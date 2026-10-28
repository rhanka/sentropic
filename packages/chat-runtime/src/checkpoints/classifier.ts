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
