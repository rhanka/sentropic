import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { chatService } from '../../services/chat-service';
import { queueManager } from '../../services/queue-manager';

export const chatRouter = new Hono();

const createMessageInput = z.object({
  sessionId: z.string().optional(),
  content: z.string().min(1),
  model: z.string().optional(),
  primaryContextType: z.enum(['company', 'folder', 'usecase', 'executive_summary']).optional(),
  primaryContextId: z.string().optional(),
  sessionTitle: z.string().optional()
});

chatRouter.get('/sessions', async (c) => {
  const user = c.get('user');
  const sessions = await chatService.listSessions(user.userId);
  return c.json({ sessions });
});

chatRouter.get('/sessions/:id/messages', async (c) => {
  const user = c.get('user');
  const sessionId = c.req.param('id');
  const messages = await chatService.listMessages(sessionId, user.userId);
  return c.json({ sessionId, messages });
});

/**
 * DELETE /api/v1/chat/sessions/:id
 * Supprime une session + cascade (messages, contexts, stream events)
 */
chatRouter.delete('/sessions/:id', async (c) => {
  const user = c.get('user');
  const sessionId = c.req.param('id');
  await chatService.deleteSession(sessionId, user.userId);
  return c.json({ ok: true });
});

/**
 * POST /api/v1/chat/messages
 * Crée un message user + un placeholder assistant, puis enfile un job `chat_message`.
 * Le SSE chat est sur streamId == assistantMessageId.
 */
chatRouter.post('/messages', zValidator('json', createMessageInput), async (c) => {
  const user = c.get('user');
  const body = c.req.valid('json');

  const created = await chatService.createUserMessageWithAssistantPlaceholder({
    userId: user.userId,
    sessionId: body.sessionId ?? null,
    content: body.content,
    model: body.model ?? null,
    primaryContextType: body.primaryContextType ?? null,
    primaryContextId: body.primaryContextId ?? null,
    sessionTitle: body.sessionTitle ?? null
  });

  const jobId = await queueManager.addJob('chat_message', {
    userId: user.userId,
    sessionId: created.sessionId,
    assistantMessageId: created.assistantMessageId,
    model: created.model
  });

  return c.json({
    sessionId: created.sessionId,
    userMessageId: created.userMessageId,
    assistantMessageId: created.assistantMessageId,
    streamId: created.streamId,
    jobId
  });
});


