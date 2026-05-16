/**
 * Per SPEC §5 — chat-core MessageStore port.
 * Owns chat-message persistence (CRUD + feedback association) independently
 * of the orchestration/streaming concerns that live in `chat-service.ts`.
 *
 * Isolated from `./ports.ts` (which pulls @sentropic/contracts and
 * @sentropic/events) so that downstream packages can consume the
 * MessageStore surface without the full chat-core dependency closure.
 * Pre BR14b wiring of contracts/events into the api Dockerfile, this
 * isolation lets the api workspace import the port via relative path.
 *
 * Field set mirrors the `chat_messages` table verbatim (id, sessionId,
 * role, content, contexts, toolCalls, toolCallId, reasoning, model,
 * promptId, promptVersionId, sequence, createdAt). `feedbackVote` is
 * carried on read-with-feedback queries to preserve the existing
 * `listMessages` / `getDetailedMessageForUser` shapes.
 */
export type ChatMessageRole = 'user' | 'assistant' | 'system' | 'tool';

export type ChatMessageRow = {
  readonly id: string;
  readonly sessionId: string;
  readonly role: string;
  readonly content: string | null;
  readonly contexts: unknown;
  readonly toolCalls: unknown;
  readonly toolCallId: string | null;
  readonly reasoning: string | null;
  readonly model: string | null;
  readonly promptId: string | null;
  readonly promptVersionId: string | null;
  readonly sequence: number;
  readonly createdAt: Date | string;
};

export type ChatMessageWithFeedback = ChatMessageRow & {
  readonly feedbackVote: number | null;
};

export type ChatMessageIdentity = {
  readonly id: string;
  readonly sessionId: string;
  readonly role: string;
  readonly sequence: number;
};

export type ChatMessageInsert = {
  readonly id: string;
  readonly sessionId: string;
  readonly role: ChatMessageRole | string;
  readonly content: string | null;
  readonly contexts?: unknown;
  readonly toolCalls?: unknown;
  readonly toolCallId?: string | null;
  readonly reasoning?: string | null;
  readonly model?: string | null;
  readonly promptId?: string | null;
  readonly promptVersionId?: string | null;
  readonly sequence: number;
  readonly createdAt: Date;
};

export type AssistantContentUpdate = {
  readonly content: string;
  readonly reasoning: string | null;
  readonly model?: string | null;
};

export type FeedbackVote = 'up' | 'down' | 'clear';

export type FeedbackResult = {
  readonly vote: number | null;
};

/**
 * MessageStore port — contracts-free surface for chat-message persistence.
 * All read methods that take `userId` enforce the session-owner authz join
 * that existed in chat-service.ts pre BR14b Lot 6.
 */
export interface MessageStore {
  // Reads
  findIdentityForUser(
    messageId: string,
    userId: string,
  ): Promise<ChatMessageIdentity | null>;

  findDetailedForUser(
    messageId: string,
    userId: string,
  ): Promise<ChatMessageWithFeedback | null>;

  listForSessionWithFeedback(
    sessionId: string,
    userId: string,
  ): Promise<ChatMessageWithFeedback[]>;

  listForSession(sessionId: string): Promise<ChatMessageRow[]>;

  findById(
    messageId: string,
  ): Promise<Pick<ChatMessageRow, 'id' | 'sessionId' | 'role' | 'content' | 'reasoning'> | null>;

  getNextSequence(sessionId: string): Promise<number>;

  // Writes
  insertMany(rows: ReadonlyArray<ChatMessageInsert>): Promise<void>;

  updateUserContent(messageId: string, content: string): Promise<void>;

  updateAssistantContent(
    messageId: string,
    update: AssistantContentUpdate,
  ): Promise<void>;

  deleteAfterSequence(sessionId: string, sequence: number): Promise<void>;

  // Feedback association
  setFeedback(
    messageId: string,
    userId: string,
    vote: FeedbackVote,
  ): Promise<FeedbackResult>;
}
