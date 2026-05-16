/**
 * BR14b Lot 15.5 — InMemoryMessageStore.
 *
 * Reference in-memory adapter for the `MessageStore` port. Mandated by
 * SPEC_STUDY_ARCHITECTURE_BOUNDARIES §5: every chat-core port ships with
 * an in-memory adapter so downstream consumers and unit tests can use the
 * runtime without any Postgres dependency.
 *
 * Behavior mirrors `PostgresChatMessageStore` (api/src/services/chat/) as
 * closely as possible while staying contracts-free and side-effect free.
 * Tenant-scoping (`findIdentityForUser`, `findDetailedForUser`,
 * `listForSessionWithFeedback`, `setFeedback`) is enforced via a small
 * `sessionsByUser` map populated at insert time through the optional
 * `seedSession` helper exposed for tests.
 */
import type {
  AssistantContentUpdate,
  ChatMessageIdentity,
  ChatMessageInsert,
  ChatMessageRow,
  ChatMessageWithFeedback,
  FeedbackResult,
  FeedbackVote,
  MessageStore,
} from '../message-port.js';

type FeedbackKey = string; // `${messageId}::${userId}`

const feedbackKey = (messageId: string, userId: string): FeedbackKey =>
  `${messageId}::${userId}`;

const cloneRow = (row: ChatMessageRow): ChatMessageRow => ({ ...row });

const rowFromInsert = (input: ChatMessageInsert): ChatMessageRow => ({
  id: input.id,
  sessionId: input.sessionId,
  role: input.role,
  content: input.content,
  contexts: input.contexts ?? null,
  toolCalls: input.toolCalls ?? null,
  toolCallId: input.toolCallId ?? null,
  reasoning: input.reasoning ?? null,
  model: input.model ?? null,
  promptId: input.promptId ?? null,
  promptVersionId: input.promptVersionId ?? null,
  sequence: input.sequence,
  createdAt: input.createdAt,
});

export class InMemoryMessageStore implements MessageStore {
  private rows: ChatMessageRow[] = [];
  private feedback = new Map<FeedbackKey, number>();
  /**
   * Maps `sessionId -> userId` so the authz-scoped reads can validate
   * ownership without coupling to a `SessionStore` instance.
   */
  private sessionOwner = new Map<string, string>();

  /** Test helper — register a session owner used by authz-scoped reads. */
  seedSession(sessionId: string, userId: string): void {
    this.sessionOwner.set(sessionId, userId);
  }

  /** Test helper — wipe all internal state. */
  reset(): void {
    this.rows = [];
    this.feedback.clear();
    this.sessionOwner.clear();
  }

  /** Test helper — snapshot of all rows ordered by sequence. */
  snapshot(): ChatMessageRow[] {
    return [...this.rows]
      .sort((a, b) => a.sequence - b.sequence)
      .map(cloneRow);
  }

  async findIdentityForUser(
    messageId: string,
    userId: string,
  ): Promise<ChatMessageIdentity | null> {
    const row = this.rows.find((r) => r.id === messageId);
    if (!row) return null;
    if (this.sessionOwner.get(row.sessionId) !== userId) return null;
    return {
      id: row.id,
      sessionId: row.sessionId,
      role: row.role,
      sequence: row.sequence,
    };
  }

  async findDetailedForUser(
    messageId: string,
    userId: string,
  ): Promise<ChatMessageWithFeedback | null> {
    const row = this.rows.find((r) => r.id === messageId);
    if (!row) return null;
    if (this.sessionOwner.get(row.sessionId) !== userId) return null;
    const vote = this.feedback.get(feedbackKey(messageId, userId)) ?? null;
    return { ...cloneRow(row), feedbackVote: vote };
  }

  async listForSessionWithFeedback(
    sessionId: string,
    userId: string,
  ): Promise<ChatMessageWithFeedback[]> {
    const matching = this.rows
      .filter((r) => r.sessionId === sessionId)
      .sort((a, b) => a.sequence - b.sequence);
    return matching.map((row) => ({
      ...cloneRow(row),
      feedbackVote: this.feedback.get(feedbackKey(row.id, userId)) ?? null,
    }));
  }

  async listForSession(sessionId: string): Promise<ChatMessageRow[]> {
    return this.rows
      .filter((r) => r.sessionId === sessionId)
      .sort((a, b) => a.sequence - b.sequence)
      .map(cloneRow);
  }

  async findById(
    messageId: string,
  ): Promise<Pick<ChatMessageRow, 'id' | 'sessionId' | 'role' | 'content' | 'reasoning'> | null> {
    const row = this.rows.find((r) => r.id === messageId);
    if (!row) return null;
    return {
      id: row.id,
      sessionId: row.sessionId,
      role: row.role,
      content: row.content,
      reasoning: row.reasoning,
    };
  }

  async getNextSequence(sessionId: string): Promise<number> {
    const max = this.rows
      .filter((r) => r.sessionId === sessionId)
      .reduce((acc, row) => (row.sequence > acc ? row.sequence : acc), 0);
    return max + 1;
  }

  async insertMany(rows: ReadonlyArray<ChatMessageInsert>): Promise<void> {
    if (rows.length === 0) return;
    for (const input of rows) {
      this.rows.push(rowFromInsert(input));
    }
  }

  async updateUserContent(messageId: string, content: string): Promise<void> {
    const row = this.rows.find((r) => r.id === messageId);
    if (!row) return;
    Object.assign(row, { content });
  }

  async updateAssistantContent(
    messageId: string,
    update: AssistantContentUpdate,
  ): Promise<void> {
    const row = this.rows.find((r) => r.id === messageId);
    if (!row) return;
    Object.assign(row, {
      content: update.content,
      reasoning: update.reasoning,
      ...(update.model !== undefined ? { model: update.model } : {}),
    });
  }

  async deleteAfterSequence(sessionId: string, sequence: number): Promise<void> {
    this.rows = this.rows.filter(
      (r) => r.sessionId !== sessionId || r.sequence <= sequence,
    );
  }

  async setFeedback(
    messageId: string,
    userId: string,
    vote: FeedbackVote,
  ): Promise<FeedbackResult> {
    if (vote === 'clear') {
      this.feedback.delete(feedbackKey(messageId, userId));
      return { vote: null };
    }
    const voteValue = vote === 'up' ? 1 : -1;
    this.feedback.set(feedbackKey(messageId, userId), voteValue);
    return { vote: voteValue };
  }
}
