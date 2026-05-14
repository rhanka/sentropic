/**
 * Per SPEC §12 — ChatState carries the chat-session checkpoint payload
 * persisted by the lenient CheckpointStore<ChatState> adapter.
 *
 * Shape derived from the existing `chat_contexts.snapshot_after` JSONB blob
 * written by chat-service.ts pre-BR14b. Field names mirror the on-disk
 * snapshot to preserve behavior across the BR14b Lot 4 extraction.
 */
export type ChatStateSnapshotMessage = {
  readonly id: string;
  readonly role: string;
  readonly content: unknown;
  readonly contexts: unknown;
  readonly toolCalls: unknown;
  readonly toolCallId: unknown;
  readonly reasoning: unknown;
  readonly model: unknown;
  readonly promptId: unknown;
  readonly promptVersionId: unknown;
  readonly sequence: unknown;
  readonly createdAt: string;
};

export type ChatStateSnapshot = {
  readonly id: string;
  readonly title: string;
  readonly anchorMessageId: string;
  readonly anchorSequence: number;
  readonly messageCount: number;
  readonly messages: ReadonlyArray<ChatStateSnapshotMessage>;
};

export type ChatStateModifications = {
  readonly action: 'checkpoint_create';
  readonly anchorMessageId: string;
  readonly anchorSequence: number;
};

export type ChatState = {
  readonly sessionId: string;
  readonly snapshot: ChatStateSnapshot;
  readonly modifications: ChatStateModifications;
  readonly createdAt: string;
};
