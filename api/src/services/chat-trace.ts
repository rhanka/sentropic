import { lt } from 'drizzle-orm';
import { db } from '../db/client';
import { chatGenerationTraces } from '../db/schema';
import { createId } from '../utils/id';

export type ChatTracePhase = 'pass1' | 'pass2';

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


