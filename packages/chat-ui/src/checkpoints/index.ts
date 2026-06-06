/**
 * @sentropic/chat-ui/checkpoints
 *
 * Generic checkpoint module — pure TS, zero sentropic domain strings.
 * Provides classifier functions, session state helpers, and the CheckpointHost
 * interface (D4 hook contract) for app-side binding.
 */

export type {
  CheckpointSummaryLike,
  CheckpointMessageLike,
  CheckpointStreamEventLike,
} from './classifier.js';

export {
  hasCheckpointMutationDelta,
  getCheckpointMutationPreviewItems,
} from './classifier.js';

export type {
  CheckpointItem,
  PendingCheckpointPrompt,
} from './checkpointState.js';

export {
  applySessionCheckpoints,
  getCheckpointForUserMessage,
  openCheckpointPrompt,
} from './checkpointState.js';

/**
 * Checkpoint represents a minimal checkpoint record as understood by the module.
 * App-side types extend this (e.g. adding title, messageCount, createdAt).
 */
export type Checkpoint = {
  id: string;
  anchorMessageId: string;
  anchorSequence: number;
  [key: string]: unknown;
};

/**
 * CheckpointHost — contract the app-side adapter must implement (D4).
 *
 * All methods are async to accommodate network calls.
 * The optional hooks (isMutatingTool, isLocalToolName, humanizeMutation) are
 * passed through to the classifier so domain-specific logic stays in the adapter.
 */
export type CheckpointHost<C extends Checkpoint = Checkpoint> = {
  /** Fetch the list of checkpoints for a session. */
  fetchCheckpoints(sessionId: string): Promise<C[]>;
  /** Create a checkpoint anchored at the given user message. */
  createCheckpoint(sessionId: string, anchorMessageId: string): Promise<void>;
  /** Restore a checkpoint (rolls back to that state). */
  restoreCheckpoint(sessionId: string, checkpointId: string): Promise<void>;

  // Optional classifier hooks (D4):

  /**
   * Returns true if the named tool is a mutating operation in the host's domain.
   * Called after built-in classifiers (git/bash/file_edit).
   * Example: `(name) => name.endsWith('_create') || name.endsWith('_update') || name.endsWith('_delete')`
   */
  isMutatingTool?: (toolName: string, argsText: string) => boolean;

  /**
   * Returns true if the tool name is a "local" tool (executed client-side).
   * Defaults to `() => false` when not provided — correct for environments
   * with no local tools (status-event tool calls are all server-side).
   */
  isLocalToolName?: (name: string) => boolean;

  /**
   * Returns a human-readable label for a mutating tool call (for preview display).
   * Called for tool calls not matched by git/bash/file_edit classifiers.
   */
  humanizeMutation?: (toolName: string, argsText: string) => string | null;
};
