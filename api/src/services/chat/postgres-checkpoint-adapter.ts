import { and, asc, desc, eq, gt } from 'drizzle-orm';

import { db } from '../../db/client';
import { chatContexts, chatMessages, chatSessions } from '../../db/schema';
import { createId } from '../../utils/id';
import type {
  CheckpointMeta,
  CheckpointStore,
  SaveResult,
} from '../../../../packages/chat-core/src/checkpoint-port';
import type { ChatState } from '../../../../packages/chat-core/src/types';

export const CHAT_CHECKPOINT_CONTEXT_TYPE = 'chat_session_checkpoint';

export type ChatCheckpointSummary = {
  id: string;
  title: string;
  anchorMessageId: string;
  anchorSequence: number;
  messageCount: number;
  createdAt: string;
};

const asRecord = (value: unknown): Record<string, unknown> | null => {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
};

/**
 * Per SPEC §12 — PostgresChatCheckpointAdapter implements CheckpointStore<ChatState>
 * with the `lenient` strategy: expectedVersion mismatches are informational only,
 * never blocking (chat UX tolerates stale-write — restore-to-latest is acceptable).
 *
 * BR14b Lot 4 — first real extraction from chat-service.ts (lines 1873-2080).
 * Domain methods (createCheckpointForSession / listCheckpointsForSession /
 * restoreCheckpointForSession) carry the verbatim logic previously embedded in
 * ChatService. Formal port methods (load/save/list/delete/tag/fork) are stubs
 * that will mature in BR14b Lot 5 once the chat-side migration consumes them.
 */
export class PostgresChatCheckpointAdapter implements CheckpointStore<ChatState> {
  // -----------------------------------------------------------------
  // CheckpointStore<ChatState> port surface (lenient strategy)
  // BR14b Lot 4: stubbed — domain methods below carry the production logic.
  // BR14b Lot 5: replace stubs with real port-level implementations.
  // -----------------------------------------------------------------
  async load(_key: string): Promise<{ state: ChatState; version: number } | null> {
    throw new Error('PostgresChatCheckpointAdapter.load not implemented in BR14b Lot 4');
  }

  async save(
    _key: string,
    _state: ChatState,
    _expectedVersion?: number,
  ): Promise<SaveResult> {
    throw new Error('PostgresChatCheckpointAdapter.save not implemented in BR14b Lot 4');
  }

  async list(
    _prefix?: string,
    _limit?: number,
  ): Promise<ReadonlyArray<CheckpointMeta>> {
    throw new Error('PostgresChatCheckpointAdapter.list not implemented in BR14b Lot 4');
  }

  async delete(_key: string): Promise<void> {
    throw new Error('PostgresChatCheckpointAdapter.delete not implemented in BR14b Lot 4');
  }

  async tag(_key: string, _label: string): Promise<void> {
    throw new Error('PostgresChatCheckpointAdapter.tag not implemented in BR14b Lot 4');
  }

  async fork(_sourceKey: string, _targetKey: string): Promise<void> {
    throw new Error('PostgresChatCheckpointAdapter.fork not implemented in BR14b Lot 4');
  }

  // -----------------------------------------------------------------
  // Domain methods — verbatim port of chat-service.ts lines 1873-2080.
  // Caller (ChatService) performs the auth check before invoking these.
  // -----------------------------------------------------------------

  async createCheckpointForSession(options: {
    sessionId: string;
    title?: string | null;
    anchorMessageId?: string | null;
  }): Promise<ChatCheckpointSummary> {
    const messages = await db
      .select({
        id: chatMessages.id,
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
      })
      .from(chatMessages)
      .where(eq(chatMessages.sessionId, options.sessionId))
      .orderBy(asc(chatMessages.sequence));

    if (messages.length === 0) {
      throw new Error('Cannot create checkpoint on an empty session');
    }

    const anchorMessage =
      (options.anchorMessageId
        ? messages.find((message) => message.id === options.anchorMessageId)
        : null) ?? messages[messages.length - 1];
    if (!anchorMessage) throw new Error('Anchor message not found');

    const anchorSequence = Number(anchorMessage.sequence ?? 0);
    if (!Number.isFinite(anchorSequence) || anchorSequence <= 0) {
      throw new Error('Invalid checkpoint anchor sequence');
    }

    const snapshotMessages = messages
      .filter((message) => Number(message.sequence ?? 0) <= anchorSequence)
      .map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content,
        contexts: message.contexts,
        toolCalls: message.toolCalls,
        toolCallId: message.toolCallId,
        reasoning: message.reasoning,
        model: message.model,
        promptId: message.promptId,
        promptVersionId: message.promptVersionId,
        sequence: message.sequence,
        createdAt:
          message.createdAt instanceof Date
            ? message.createdAt.toISOString()
            : String(message.createdAt ?? ''),
      }));

    const checkpointId = createId();
    const now = new Date();
    const title =
      typeof options.title === 'string' && options.title.trim().length > 0
        ? options.title.trim()
        : `Checkpoint #${anchorSequence}`;

    const snapshot = {
      id: checkpointId,
      title,
      anchorMessageId: anchorMessage.id,
      anchorSequence,
      messageCount: snapshotMessages.length,
      messages: snapshotMessages,
    };

    await db.insert(chatContexts).values({
      id: checkpointId,
      sessionId: options.sessionId,
      contextType: CHAT_CHECKPOINT_CONTEXT_TYPE,
      contextId: checkpointId,
      snapshotBefore: null,
      snapshotAfter: snapshot,
      modifications: {
        action: 'checkpoint_create',
        anchorMessageId: anchorMessage.id,
        anchorSequence,
      },
      modifiedAt: now,
      createdAt: now,
    });

    return {
      id: checkpointId,
      title,
      anchorMessageId: anchorMessage.id,
      anchorSequence,
      messageCount: snapshotMessages.length,
      createdAt: now.toISOString(),
    };
  }

  async listCheckpointsForSession(options: {
    sessionId: string;
    limit?: number;
  }): Promise<ChatCheckpointSummary[]> {
    const limit = Number.isFinite(options.limit)
      ? Math.min(Math.max(Math.floor(options.limit as number), 1), 100)
      : 20;

    const rows = await db
      .select({
        id: chatContexts.id,
        snapshotAfter: chatContexts.snapshotAfter,
        createdAt: chatContexts.createdAt,
      })
      .from(chatContexts)
      .where(
        and(
          eq(chatContexts.sessionId, options.sessionId),
          eq(chatContexts.contextType, CHAT_CHECKPOINT_CONTEXT_TYPE),
        ),
      )
      .orderBy(desc(chatContexts.createdAt))
      .limit(limit);

    return rows.map((row) => {
      const snapshot = asRecord(row.snapshotAfter) ?? {};
      const titleRaw = String(snapshot.title ?? '').trim();
      const anchorMessageId = String(snapshot.anchorMessageId ?? '').trim();
      const anchorSequence = Number(snapshot.anchorSequence ?? 0);
      const messageCount = Number(snapshot.messageCount ?? 0);
      const createdAt =
        row.createdAt instanceof Date
          ? row.createdAt.toISOString()
          : new Date(String(row.createdAt ?? '')).toISOString();
      return {
        id: row.id,
        title: titleRaw || `Checkpoint #${anchorSequence || 0}`,
        anchorMessageId,
        anchorSequence: Number.isFinite(anchorSequence) ? anchorSequence : 0,
        messageCount: Number.isFinite(messageCount) ? messageCount : 0,
        createdAt,
      };
    });
  }

  async restoreCheckpointForSession(options: {
    sessionId: string;
    checkpointId: string;
  }): Promise<{
    checkpointId: string;
    restoredToSequence: number;
    removedMessages: number;
  }> {
    const [checkpoint] = await db
      .select({
        id: chatContexts.id,
        snapshotAfter: chatContexts.snapshotAfter,
      })
      .from(chatContexts)
      .where(
        and(
          eq(chatContexts.id, options.checkpointId),
          eq(chatContexts.sessionId, options.sessionId),
          eq(chatContexts.contextType, CHAT_CHECKPOINT_CONTEXT_TYPE),
        ),
      );
    if (!checkpoint) throw new Error('Checkpoint not found');

    const snapshot = asRecord(checkpoint.snapshotAfter);
    const restoredToSequence = Number(snapshot?.anchorSequence ?? 0);
    if (!Number.isFinite(restoredToSequence) || restoredToSequence <= 0) {
      throw new Error('Invalid checkpoint payload');
    }

    const removedRows = await db
      .delete(chatMessages)
      .where(
        and(
          eq(chatMessages.sessionId, options.sessionId),
          gt(chatMessages.sequence, restoredToSequence),
        ),
      )
      .returning({ id: chatMessages.id });

    await db
      .update(chatSessions)
      .set({ updatedAt: new Date() })
      .where(eq(chatSessions.id, options.sessionId));

    return {
      checkpointId: checkpoint.id,
      restoredToSequence,
      removedMessages: removedRows.length,
    };
  }
}

export const postgresChatCheckpointAdapter = new PostgresChatCheckpointAdapter();
