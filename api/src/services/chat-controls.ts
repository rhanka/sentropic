import { and, eq, gte, sql } from 'drizzle-orm';

import { db } from '../db/client';
import { chatMessages, chatSessions } from '../db/schema';
import { createId } from '../utils/id';
import { chatService } from './chat-service';
import { queueManager } from './queue-manager';
import { writeStreamEventWithSequenceRetry } from './stream-service';

export const chatControls = {
  async stop(input: {
    assistantMessageId: string;
    userId: string;
  }): Promise<{ ok: true; jobId: string | null }> {
    const message = await chatService.getMessageForUser(
      input.assistantMessageId,
      input.userId,
    );
    if (!message) throw new Error('Message not found');
    if (message.role !== 'assistant') {
      throw new Error('Only assistant messages can be stopped');
    }

    const rows = (await db.all(sql`
      SELECT id, status
      FROM job_queue
      WHERE type = 'chat_message'
        AND (data::jsonb->>'assistantMessageId') = ${input.assistantMessageId}
        AND (data::jsonb->>'userId') = ${input.userId}
      ORDER BY created_at DESC
      LIMIT 1
    `)) as Array<{ id: string; status: string }>;
    const job = rows[0];
    if (job?.id) await queueManager.cancelJob(job.id, 'user_stop');
    if (!job || job.status !== 'processing') {
      await chatService.finalizeAssistantMessageFromStream({
        assistantMessageId: input.assistantMessageId,
        reason: 'user_stop',
        fallbackContent: 'Réponse interrompue.',
      });
    }
    return { ok: true, jobId: job?.id ?? null };
  },

  async steer(input: {
    assistantMessageId: string;
    userId: string;
    message: string;
    metadata?: Record<string, unknown>;
  }) {
    const assistant = await chatService.getMessageForUser(
      input.assistantMessageId,
      input.userId,
    );
    if (!assistant) throw new Error('Message not found');
    if (assistant.role !== 'assistant') {
      throw new Error('Only assistant messages can be steered');
    }

    const metadata = input.metadata ?? {};
    await writeStreamEventWithSequenceRetry(
      input.assistantMessageId,
      'status',
      {
        state: 'steer_received',
        message: input.message,
        metadata,
        actor: 'user',
        actorId: input.userId,
      },
      { messageId: input.assistantMessageId },
    );

    let steerMessageId: string | null = null;
    try {
      await db.transaction(async (tx) => {
        const insertedSteerMessageId = createId();
        await tx.update(chatMessages)
          .set({ sequence: sql`${chatMessages.sequence} + 1` })
          .where(and(
            eq(chatMessages.sessionId, assistant.sessionId),
            gte(chatMessages.sequence, assistant.sequence),
          ));
        await tx.insert(chatMessages).values({
          id: insertedSteerMessageId,
          sessionId: assistant.sessionId,
          role: 'user',
          content: input.message,
          toolCalls: null,
          toolCallId: null,
          reasoning: null,
          model: null,
          promptId: null,
          promptVersionId: null,
          contexts: null,
          sequence: assistant.sequence,
          createdAt: new Date(),
        });
        await tx.update(chatSessions)
          .set({ updatedAt: new Date() })
          .where(eq(chatSessions.id, assistant.sessionId));
        steerMessageId = insertedSteerMessageId;
      });
    } catch (error) {
      console.error('[chat/steer] failed to persist steer message', {
        assistantMessageId: input.assistantMessageId,
        error,
      });
    }

    return {
      assistantMessageId: input.assistantMessageId,
      status: 'accepted' as const,
      action: 'interrupt_relaunch' as const,
      steer: { messageId: steerMessageId, message: input.message, metadata },
    };
  },
};
