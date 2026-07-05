/**
 * checkpointState.ts — Generic checkpoint session state helpers.
 *
 * Pure TypeScript, zero sentropic domain strings.
 * These helpers manage the in-memory view of session checkpoints:
 * keying them by anchor message id for O(1) lookup.
 */

export type CheckpointItem = {
  id: string;
  anchorMessageId: string;
  anchorSequence: number;
  [key: string]: unknown;
};

export type PendingCheckpointPrompt<C extends CheckpointItem = CheckpointItem> = {
  kind: 'restore' | 'retry';
  checkpoint: C;
  userMessageId: string;
  assistantMessageId?: string;
};

/**
 * Indexes a list of checkpoints by anchorMessageId (first checkpoint per anchor wins).
 * Returns a Map suitable for O(1) lookup in getCheckpointForUserMessage.
 */
export const applySessionCheckpoints = <C extends CheckpointItem>(
  items: C[],
): Map<string, C> => {
  const map = new Map<string, C>();
  for (const checkpoint of items) {
    const anchorId = String(checkpoint.anchorMessageId ?? '').trim();
    if (!anchorId || map.has(anchorId)) continue;
    map.set(anchorId, checkpoint);
  }
  return map;
};

/**
 * Returns the checkpoint anchored at the given user message id, or null.
 */
export const getCheckpointForUserMessage = <C extends CheckpointItem>(
  checkpointsByAnchorMessageId: Map<string, C>,
  userMessageId: string,
): C | null => {
  const id = String(userMessageId ?? '').trim();
  if (!id) return null;
  return checkpointsByAnchorMessageId.get(id) ?? null;
};

/**
 * Builds a pending prompt object for the restore/retry flow.
 */
export const openCheckpointPrompt = <C extends CheckpointItem>(
  checkpoint: C,
  userMessageId: string,
  kind: 'restore' | 'retry',
  assistantMessageId?: string,
): PendingCheckpointPrompt<C> => ({
  kind,
  checkpoint,
  userMessageId,
  ...(assistantMessageId !== undefined ? { assistantMessageId } : {}),
});
