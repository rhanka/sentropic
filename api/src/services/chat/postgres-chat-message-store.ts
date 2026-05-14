import { and, asc, eq, gt, sql } from 'drizzle-orm';

import { db } from '../../db/client';
import { chatMessageFeedback, chatMessages, chatSessions } from '../../db/schema';
import { createId } from '../../utils/id';
import type {
  AssistantContentUpdate,
  ChatMessageIdentity,
  ChatMessageInsert,
  ChatMessageRow,
  ChatMessageWithFeedback,
  FeedbackResult,
  FeedbackVote,
  MessageStore,
} from '../../../../packages/chat-core/src/message-port';

/**
 * Per SPEC §5 — PostgresChatMessageStore implements MessageStore over Drizzle.
 *
 * BR14b Lot 6 — first real extraction of chat-message persistence from
 * chat-service.ts. Methods carry the VERBATIM SQL/Drizzle logic that
 * previously lived inline in ChatService.* (getMessageForUser,
 * getDetailedMessageForUser, listMessages DB part, getNextMessageSequence,
 * createUserMessageWithAssistantPlaceholder insert, retryUserMessage
 * delete+insert, updateUserMessageContent update, runAssistantGeneration
 * conversation load + final update, finalizeAssistantMessageFromStream
 * read+update, setMessageFeedback feedback CRUD).
 *
 * Caller (ChatService) preserves all orchestration concerns (workspace
 * resolution, todoRuntime, model resolution, session updatedAt touches,
 * stream events, title generation). This adapter is persistence-only.
 */
export class PostgresChatMessageStore implements MessageStore {
  async findIdentityForUser(
    messageId: string,
    userId: string,
  ): Promise<ChatMessageIdentity | null> {
    const [row] = await db
      .select({
        id: chatMessages.id,
        sessionId: chatMessages.sessionId,
        role: chatMessages.role,
        sequence: chatMessages.sequence,
      })
      .from(chatMessages)
      .innerJoin(chatSessions, eq(chatMessages.sessionId, chatSessions.id))
      .where(and(eq(chatMessages.id, messageId), eq(chatSessions.userId, userId)));
    return row ?? null;
  }

  async findDetailedForUser(
    messageId: string,
    userId: string,
  ): Promise<ChatMessageWithFeedback | null> {
    const [row] = await db
      .select({
        id: chatMessages.id,
        sessionId: chatMessages.sessionId,
        role: chatMessages.role,
        content: chatMessages.content,
        contexts: chatMessages.contexts,
        toolCalls: chatMessages.toolCalls,
        toolCallId: chatMessages.toolCallId,
        reasoning: chatMessages.reasoning,
        model: chatMessages.model,
        promptId: chatMessages.promptId,
        promptVersionId: chatMessages.promptVersionId,
        sequence: chatMessages.sequence,
        createdAt: chatMessages.createdAt,
        feedbackVote: chatMessageFeedback.vote,
      })
      .from(chatMessages)
      .innerJoin(chatSessions, eq(chatMessages.sessionId, chatSessions.id))
      .leftJoin(
        chatMessageFeedback,
        and(
          eq(chatMessageFeedback.messageId, chatMessages.id),
          eq(chatMessageFeedback.userId, userId),
        ),
      )
      .where(and(eq(chatMessages.id, messageId), eq(chatSessions.userId, userId)));
    return (row as ChatMessageWithFeedback | undefined) ?? null;
  }

  async listForSessionWithFeedback(
    sessionId: string,
    userId: string,
  ): Promise<ChatMessageWithFeedback[]> {
    const rows = await db
      .select({
        id: chatMessages.id,
        sessionId: chatMessages.sessionId,
        role: chatMessages.role,
        content: chatMessages.content,
        contexts: chatMessages.contexts,
        toolCalls: chatMessages.toolCalls,
        toolCallId: chatMessages.toolCallId,
        reasoning: chatMessages.reasoning,
        model: chatMessages.model,
        promptId: chatMessages.promptId,
        promptVersionId: chatMessages.promptVersionId,
        sequence: chatMessages.sequence,
        createdAt: chatMessages.createdAt,
        feedbackVote: chatMessageFeedback.vote,
      })
      .from(chatMessages)
      .leftJoin(
        chatMessageFeedback,
        and(
          eq(chatMessageFeedback.messageId, chatMessages.id),
          eq(chatMessageFeedback.userId, userId),
        ),
      )
      .where(eq(chatMessages.sessionId, sessionId))
      .orderBy(asc(chatMessages.sequence));
    return rows as ChatMessageWithFeedback[];
  }

  async listForSession(sessionId: string): Promise<ChatMessageRow[]> {
    const rows = await db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.sessionId, sessionId))
      .orderBy(asc(chatMessages.sequence));
    return rows as ChatMessageRow[];
  }

  async findById(
    messageId: string,
  ): Promise<
    Pick<ChatMessageRow, 'id' | 'sessionId' | 'role' | 'content' | 'reasoning'> | null
  > {
    const [row] = await db
      .select({
        id: chatMessages.id,
        sessionId: chatMessages.sessionId,
        role: chatMessages.role,
        content: chatMessages.content,
        reasoning: chatMessages.reasoning,
      })
      .from(chatMessages)
      .where(eq(chatMessages.id, messageId))
      .limit(1);
    return row ?? null;
  }

  async getNextSequence(sessionId: string): Promise<number> {
    const result = await db
      .select({ maxSequence: sql<number>`MAX(${chatMessages.sequence})` })
      .from(chatMessages)
      .where(eq(chatMessages.sessionId, sessionId));
    const maxSequence = result[0]?.maxSequence ?? 0;
    return maxSequence + 1;
  }

  async insertMany(rows: ReadonlyArray<ChatMessageInsert>): Promise<void> {
    if (rows.length === 0) return;
    await db.insert(chatMessages).values(
      rows.map((row) => ({
        id: row.id,
        sessionId: row.sessionId,
        role: row.role,
        content: row.content,
        contexts: row.contexts ?? null,
        toolCalls: row.toolCalls ?? null,
        toolCallId: row.toolCallId ?? null,
        reasoning: row.reasoning ?? null,
        model: row.model ?? null,
        promptId: row.promptId ?? null,
        promptVersionId: row.promptVersionId ?? null,
        sequence: row.sequence,
        createdAt: row.createdAt,
      })),
    );
  }

  async updateUserContent(messageId: string, content: string): Promise<void> {
    await db
      .update(chatMessages)
      .set({ content })
      .where(eq(chatMessages.id, messageId));
  }

  async updateAssistantContent(
    messageId: string,
    update: AssistantContentUpdate,
  ): Promise<void> {
    const patch: { content: string; reasoning: string | null; model?: string | null } = {
      content: update.content,
      reasoning: update.reasoning,
    };
    if (update.model !== undefined) {
      patch.model = update.model;
    }
    await db
      .update(chatMessages)
      .set(patch)
      .where(eq(chatMessages.id, messageId));
  }

  async deleteAfterSequence(sessionId: string, sequence: number): Promise<void> {
    await db
      .delete(chatMessages)
      .where(
        and(
          eq(chatMessages.sessionId, sessionId),
          gt(chatMessages.sequence, sequence),
        ),
      );
  }

  async setFeedback(
    messageId: string,
    userId: string,
    vote: FeedbackVote,
  ): Promise<FeedbackResult> {
    if (vote === 'clear') {
      await db
        .delete(chatMessageFeedback)
        .where(
          and(
            eq(chatMessageFeedback.messageId, messageId),
            eq(chatMessageFeedback.userId, userId),
          ),
        );
      return { vote: null };
    }
    const voteValue = vote === 'up' ? 1 : -1;
    const now = new Date();
    await db
      .insert(chatMessageFeedback)
      .values({
        id: createId(),
        messageId,
        userId,
        vote: voteValue,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [chatMessageFeedback.messageId, chatMessageFeedback.userId],
        set: { vote: voteValue, updatedAt: now },
      });
    return { vote: voteValue };
  }
}

export const postgresChatMessageStore = new PostgresChatMessageStore();
