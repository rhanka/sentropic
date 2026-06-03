import { lt } from 'drizzle-orm';
import { db } from '../db/client';
import { chatGenerationTraces } from '../db/schema';
import { createId } from '../utils/id';
import { findPgError } from '../utils/pg-errors';

export type ChatTracePhase = 'pass1' | 'pass2';

/**
 * The parent `chat_sessions` / `chat_messages` row referenced by a generation
 * trace was deleted (e.g. session cascade) while the trace was still being
 * flushed. Both FKs declare `ON DELETE CASCADE`, so the parent's removal is
 * meant to take these traces with it — writing a now-orphaned trace is a no-op,
 * not a fatal error for the generation job. We only swallow these two specific
 * parent-FK violations; any other FK error still propagates.
 */
const isOrphanTraceParentFkError = (error: unknown): boolean => {
  const pgError = findPgError(error, '23503');
  if (!pgError) return false;
  const matches = (needle: string): boolean =>
    (pgError.constraint?.includes(needle) ?? false) ||
    (pgError.message?.includes(needle) ?? false);
  return (
    matches('chat_generation_traces_session_id_chat_sessions_id_fk') ||
    matches('chat_generation_traces_assistant_message_id_chat_messages_id_fk')
  );
};

export type ChatTraceToolCall = {
  id?: string;
  name: string;
  args?: unknown;
  result?: unknown;
};

export async function writeChatGenerationTrace(input: {
  enabled: boolean;
  sessionId: string;
  assistantMessageId: string;
  userId: string;
  workspaceId?: string | null;
  phase: ChatTracePhase;
  iteration: number;
  model?: string | null;
  toolChoice?: string | null;
  tools?: unknown;
  openaiMessages: unknown;
  toolCalls?: ChatTraceToolCall[] | null;
  meta?: Record<string, unknown> | null;
}): Promise<void> {
  if (!input.enabled) return;

  type TraceInsert = typeof chatGenerationTraces.$inferInsert;

  try {
    await db.insert(chatGenerationTraces).values({
      id: createId(),
      sessionId: input.sessionId,
      assistantMessageId: input.assistantMessageId,
      userId: input.userId,
      workspaceId: input.workspaceId ?? null,
      phase: input.phase,
      iteration: input.iteration,
      model: input.model ?? null,
      toolChoice: input.toolChoice ?? null,
      tools: (input.tools ?? null) as TraceInsert['tools'],
      openaiMessages: input.openaiMessages as TraceInsert['openaiMessages'],
      toolCalls: (input.toolCalls ?? null) as TraceInsert['toolCalls'],
      meta: (input.meta ?? null) as TraceInsert['meta'],
      createdAt: new Date()
    });
  } catch (error) {
    if (isOrphanTraceParentFkError(error)) {
      // Parent session/message row was deleted (cascade) mid-flight. The
      // ON DELETE CASCADE FKs mean this trace would be removed anyway, so
      // dropping it is the correct no-op rather than crashing the job.
      return;
    }
    throw error;
  }
}

export async function purgeOldChatTraces(retentionDays: number): Promise<number> {
  const days = Number.isFinite(retentionDays) ? retentionDays : 7;
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const deleted = await db
    .delete(chatGenerationTraces)
    .where(lt(chatGenerationTraces.createdAt, cutoff))
    .returning({ id: chatGenerationTraces.id });
  return deleted.length;
}


