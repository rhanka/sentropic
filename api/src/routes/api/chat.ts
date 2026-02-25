import { Hono } from 'hono';
import { z } from 'zod';
import { and, desc, eq, sql } from 'drizzle-orm';
import { zValidator } from '@hono/zod-validator';
import { chatService } from '../../services/chat-service';
import { queueManager } from '../../services/queue-manager';
import { readStreamEvents } from '../../services/stream-service';
import { db } from '../../db/client';
import { extensionToolPermissions } from '../../db/schema';
import { requireWorkspaceAccessRole, requireWorkspaceEditorRole } from '../../middleware/workspace-rbac';
import { createId } from '../../utils/id';
import { resolveLocaleFromHeaders } from '../../utils/locale';

export const chatRouter = new Hono();

const chatContextInput = z.object({
  contextType: z.enum(['organization', 'folder', 'usecase', 'executive_summary']),
  contextId: z.string().min(1)
});

const localToolDefinitionInput = z.object({
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-zA-Z0-9_-]+$/),
  description: z.string().min(1).max(1000),
  parameters: z.record(z.string(), z.unknown())
});

const createMessageInput = z.object({
  sessionId: z.string().optional(),
  content: z.string().min(1),
  providerId: z.enum(['openai', 'gemini']).optional(),
  providerApiKey: z.string().min(1).optional(),
  model: z.string().optional(),
  workspace_id: z.string().optional(),
  primaryContextType: z.enum(['organization', 'folder', 'usecase', 'executive_summary']).optional(),
  primaryContextId: z.string().optional(),
  sessionTitle: z.string().optional(),
  contexts: z.array(chatContextInput).optional(),
  tools: z.array(z.string()).optional(),
  localToolDefinitions: z.array(localToolDefinitionInput).max(32).optional()
});

const feedbackInput = z.object({
  vote: z.enum(['up', 'down', 'clear'])
});

const editMessageInput = z.object({
  content: z.string().min(1)
});

const retryMessageInput = z.object({
  providerId: z.enum(['openai', 'gemini']).optional(),
  model: z.string().min(1).optional(),
});

const createSessionInput = z.object({
  primaryContextType: z.enum(['organization', 'folder', 'usecase', 'executive_summary']).optional(),
  primaryContextId: z.string().optional(),
  sessionTitle: z.string().optional()
});

const toolResultInput = z.object({
  toolCallId: z.string().min(1),
  result: z.unknown()
});

const extensionToolPermissionInput = z.object({
  toolName: z.string().min(1).max(96),
  origin: z.string().min(1),
  policy: z.enum(['allow', 'deny']),
});

const extensionToolPermissionDeleteInput = z.object({
  toolName: z.string().min(1).max(96),
  origin: z.string().min(1),
});

const TOOL_PATTERN_REGEX = /^[a-z0-9:_*-]{1,96}$/i;
const HOSTNAME_LABEL_REGEX = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
const IPV4_REGEX =
  /^(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;

const normalizeToolPattern = (raw: string): string | null => {
  const value = raw.trim().toLowerCase();
  if (!value) return null;
  if (!TOOL_PATTERN_REGEX.test(value)) return null;
  if (value.includes('**')) return null;
  return value;
};

const isValidHostname = (host: string): boolean => {
  const value = host.trim().toLowerCase();
  if (!value) return false;
  if (value === 'localhost') return true;
  if (IPV4_REGEX.test(value)) return true;
  const labels = value.split('.');
  if (labels.length < 2) return false;
  return labels.every((label) => HOSTNAME_LABEL_REGEX.test(label));
};

const normalizeRuntimeOrigin = (raw: string): string | null => {
  const value = raw.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    const hostname = url.hostname.toLowerCase();
    const port = url.port ? `:${url.port}` : '';
    return `${url.protocol}//${hostname}${port}`;
  } catch {
    return null;
  }
};

const normalizeOriginPattern = (raw: string): string | null => {
  const value = raw.trim().toLowerCase();
  if (!value) return null;
  if (value === '*') return '*';

  const schemeAnyHostMatch = value.match(/^(https?:)\/\/\*$/);
  if (schemeAnyHostMatch) {
    return `${schemeAnyHostMatch[1]}//*`;
  }

  if (value.startsWith('*.')) {
    const suffix = value.slice(2);
    if (!isValidHostname(suffix)) return null;
    return `*.${suffix}`;
  }

  const wildcardSchemeMatch = value.match(/^(https?:)\/\/\*\.(.+)$/);
  if (wildcardSchemeMatch) {
    const scheme = wildcardSchemeMatch[1];
    const suffix = wildcardSchemeMatch[2];
    if (!isValidHostname(suffix)) return null;
    return `${scheme}//*.${suffix}`;
  }

  if (isValidHostname(value)) {
    return value;
  }

  return normalizeRuntimeOrigin(value);
};

chatRouter.get('/tool-permissions', requireWorkspaceAccessRole(), async (c) => {
  const user = c.get('user');
  const rows = await db
    .select({
      toolName: extensionToolPermissions.toolName,
      origin: extensionToolPermissions.origin,
      policy: extensionToolPermissions.policy,
      updatedAt: extensionToolPermissions.updatedAt,
    })
    .from(extensionToolPermissions)
    .where(
      and(
        eq(extensionToolPermissions.userId, user.userId),
        eq(extensionToolPermissions.workspaceId, user.workspaceId),
      ),
    )
    .orderBy(desc(extensionToolPermissions.updatedAt));

  return c.json({
    items: rows.map((row) => ({
      toolName: row.toolName,
      origin: row.origin,
      policy: row.policy,
      updatedAt:
        row.updatedAt instanceof Date
          ? row.updatedAt.toISOString()
          : new Date(row.updatedAt as unknown as string).toISOString(),
    })),
  });
});

chatRouter.put(
  '/tool-permissions',
  requireWorkspaceAccessRole(),
  zValidator('json', extensionToolPermissionInput),
  async (c) => {
    const user = c.get('user');
    const body = c.req.valid('json');
    const toolName = normalizeToolPattern(body.toolName);
    if (!toolName) {
      return c.json({ error: 'Invalid tool pattern' }, 400);
    }
    const origin = normalizeOriginPattern(body.origin);
    if (!origin) {
      return c.json({ error: 'Invalid origin pattern' }, 400);
    }

    const now = new Date();
    await db
      .insert(extensionToolPermissions)
      .values({
        id: createId(),
        userId: user.userId,
        workspaceId: user.workspaceId,
        toolName,
        origin,
        policy: body.policy,
        updatedAt: now,
        createdAt: now,
      })
      .onConflictDoUpdate({
        target: [
          extensionToolPermissions.userId,
          extensionToolPermissions.workspaceId,
          extensionToolPermissions.toolName,
          extensionToolPermissions.origin,
        ],
        set: {
          policy: body.policy,
          updatedAt: now,
        },
      });

    return c.json({
      ok: true,
      item: {
        toolName,
        origin,
        policy: body.policy,
        updatedAt: now.toISOString(),
      },
    });
  },
);

chatRouter.delete(
  '/tool-permissions',
  requireWorkspaceAccessRole(),
  zValidator('json', extensionToolPermissionDeleteInput),
  async (c) => {
    const user = c.get('user');
    const body = c.req.valid('json');
    const toolName = normalizeToolPattern(body.toolName);
    if (!toolName) {
      return c.json({ error: 'Invalid tool pattern' }, 400);
    }
    const origin = normalizeOriginPattern(body.origin);
    if (!origin) {
      return c.json({ error: 'Invalid origin pattern' }, 400);
    }

    await db.delete(extensionToolPermissions).where(
      and(
        eq(extensionToolPermissions.userId, user.userId),
        eq(extensionToolPermissions.workspaceId, user.workspaceId),
        eq(extensionToolPermissions.toolName, toolName),
        eq(extensionToolPermissions.origin, origin),
      ),
    );

    return c.json({ ok: true });
  },
);

chatRouter.get('/sessions', async (c) => {
  const user = c.get('user');
  const sessions = await chatService.listSessions(user.userId);
  return c.json({ sessions });
});

chatRouter.post('/sessions', requireWorkspaceAccessRole(), zValidator('json', createSessionInput), async (c) => {
  const user = c.get('user');
  const body = c.req.valid('json');
  const res = await chatService.createSession({
    userId: user.userId,
    workspaceId: user.workspaceId,
    primaryContextType: body.primaryContextType ?? null,
    primaryContextId: body.primaryContextId ?? null,
    title: body.sessionTitle ?? null
  });
  return c.json({ sessionId: res.sessionId });
});

chatRouter.get('/sessions/:id/messages', async (c) => {
  const user = c.get('user');
  const sessionId = c.req.param('id');
  const messages = await chatService.listMessages(sessionId, user.userId);
  return c.json({ sessionId, messages });
});

/**
 * GET /api/v1/chat/sessions/:id/stream-events
 * Optimisation batch (Option C): relecture des events pour les N derniers messages assistant d'une session.
 */
chatRouter.get('/sessions/:id/stream-events', async (c) => {
  const user = c.get('user');
  const sessionId = c.req.param('id');

  const url = new URL(c.req.url);
  const limitMessagesRaw = url.searchParams.get('limitMessages');
  const limitEventsRaw = url.searchParams.get('limitEvents');
  const limitMessages = limitMessagesRaw ? Number(limitMessagesRaw) : undefined;
  const limitEventsPerMessage = limitEventsRaw ? Number(limitEventsRaw) : undefined;

  const streams = await chatService.listStreamEventsForSession({
    sessionId,
    userId: user.userId,
    limitMessages: Number.isFinite(limitMessages as number) ? (limitMessages as number) : undefined,
    limitEventsPerMessage: Number.isFinite(limitEventsPerMessage as number) ? (limitEventsPerMessage as number) : undefined
  });

  return c.json({ sessionId, streams });
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
 * GET /api/v1/chat/messages/:id/stream-events
 * Relecture des events (option C) pour reconstruire reasoning/tools d'une session.
 * streamId == messageId pour le chat.
 */
chatRouter.get('/messages/:id/stream-events', async (c) => {
  const user = c.get('user');
  const messageId = c.req.param('id');
  const msg = await chatService.getMessageForUser(messageId, user.userId);
  if (!msg) return c.json({ error: 'Message not found' }, 404);

  const url = new URL(c.req.url);
  const sinceSequenceRaw = url.searchParams.get('sinceSequence');
  const limitRaw = url.searchParams.get('limit');
  const sinceSequence = sinceSequenceRaw ? Number(sinceSequenceRaw) : undefined;
  const limit = limitRaw ? Number(limitRaw) : 2000;

  const events = await readStreamEvents(messageId, Number.isFinite(sinceSequence as number) ? sinceSequence : undefined, Number.isFinite(limit) ? limit : 2000);
  return c.json({ messageId, streamId: messageId, events });
});

/**
 * POST /api/v1/chat/messages/:id/stop
 * Interrompt la génération en cours (chat_message) et finalise avec le contenu partiel.
 */
chatRouter.post('/messages/:id/stop', requireWorkspaceAccessRole(), async (c) => {
  const user = c.get('user');
  const messageId = c.req.param('id');

  const msg = await chatService.getMessageForUser(messageId, user.userId);
  if (!msg) return c.json({ error: 'Message not found' }, 404);
  if (msg.role !== 'assistant') return c.json({ error: 'Only assistant messages can be stopped' }, 400);

  const rows = (await db.all(sql`
    SELECT id, status
    FROM job_queue
    WHERE type = 'chat_message'
      AND (data::jsonb->>'assistantMessageId') = ${messageId}
      AND (data::jsonb->>'userId') = ${user.userId}
    ORDER BY created_at DESC
    LIMIT 1
  `)) as Array<{ id: string; status: string }>;

  const job = rows?.[0];
  const jobId = job?.id;
  if (jobId) {
    await queueManager.cancelJob(jobId, 'user_stop');
  }

  const shouldFinalize = !job || job.status !== 'processing';
  if (shouldFinalize) {
    await chatService.finalizeAssistantMessageFromStream({
      assistantMessageId: messageId,
      reason: 'user_stop',
      fallbackContent: 'Réponse interrompue.'
    });
  }

  return c.json({ ok: true, jobId: jobId ?? null });
});

/**
 * POST /api/v1/chat/messages/:id/feedback
 * Set user feedback (👍/👎) on an assistant message.
 */
chatRouter.post('/messages/:id/feedback', requireWorkspaceAccessRole(), zValidator('json', feedbackInput), async (c) => {
  const user = c.get('user');
  const messageId = c.req.param('id');
  const body = c.req.valid('json');

  try {
    const result = await chatService.setMessageFeedback({
      messageId,
      userId: user.userId,
      vote: body.vote
    });
    return c.json({ messageId, vote: result.vote });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unable to set feedback';
    const status = msg === 'Message not found' ? 404 : 400;
    return c.json({ error: msg }, status);
  }
});

/**
 * PATCH /api/v1/chat/messages/:id
 * Edit a user message content.
 */
chatRouter.patch('/messages/:id', requireWorkspaceEditorRole(), zValidator('json', editMessageInput), async (c) => {
  const user = c.get('user');
  const messageId = c.req.param('id');
  const body = c.req.valid('json');

  try {
    const result = await chatService.updateUserMessageContent({
      messageId,
      userId: user.userId,
      content: body.content
    });
    return c.json({ messageId: result.messageId });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unable to edit message';
    const status = msg === 'Message not found' ? 404 : 400;
    return c.json({ error: msg }, status);
  }
});

/**
 * POST /api/v1/chat/messages/:id/retry
 * Retry a user message (deletes subsequent messages and re-queues assistant).
 */
chatRouter.post('/messages/:id/retry', requireWorkspaceAccessRole(), async (c) => {
  const user = c.get('user');
  const messageId = c.req.param('id');
  const payload = retryMessageInput.safeParse(await c.req.json().catch(() => ({})));
  if (!payload.success) {
    return c.json(
      {
        error: 'Invalid retry payload',
        details: payload.error.issues,
      },
      400
    );
  }
  const requestLocale = resolveLocaleFromHeaders({
    appLocaleHeader: c.req.header('x-app-locale'),
    acceptLanguageHeader: c.req.header('accept-language')
  });

  try {
    const created = await chatService.retryUserMessage({
      messageId,
      userId: user.userId,
      providerId: payload.data.providerId ?? null,
      model: payload.data.model ?? null,
    });
    const jobId = await queueManager.addJob(
      'chat_message',
      {
        userId: user.userId,
        sessionId: created.sessionId,
        assistantMessageId: created.assistantMessageId,
        providerId: created.providerId,
        model: created.model,
        locale: requestLocale
      },
      { workspaceId: user.workspaceId }
    );

    return c.json({
      sessionId: created.sessionId,
      userMessageId: created.userMessageId,
      assistantMessageId: created.assistantMessageId,
      streamId: created.streamId,
      jobId
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unable to retry message';
    const status = msg === 'Message not found' ? 404 : 400;
    return c.json({ error: msg }, status);
  }
});

/**
 * POST /api/v1/chat/messages
 * Crée un message user + un placeholder assistant, puis enfile un job `chat_message`.
 * Le SSE chat est sur streamId == assistantMessageId.
 */
chatRouter.post('/messages', requireWorkspaceAccessRole(), zValidator('json', createMessageInput), async (c) => {
  const user = c.get('user');
  const body = c.req.valid('json');
  const requestLocale = resolveLocaleFromHeaders({
    appLocaleHeader: c.req.header('x-app-locale'),
    acceptLanguageHeader: c.req.header('accept-language')
  });

  // Workspace scope for chat: user.workspaceId is already resolved by requireAuth middleware
  const targetWorkspaceId = user.workspaceId as string;

  const created = await chatService.createUserMessageWithAssistantPlaceholder({
    userId: user.userId,
    sessionId: body.sessionId ?? null,
    content: body.content,
    providerId: body.providerId ?? null,
    providerApiKey: body.providerApiKey ?? null,
    model: body.model ?? null,
    workspaceId: targetWorkspaceId,
    primaryContextType: body.primaryContextType ?? null,
    primaryContextId: body.primaryContextId ?? null,
    contexts: body.contexts ?? undefined,
    sessionTitle: body.sessionTitle ?? null
  });

  const jobId = await queueManager.addJob('chat_message', {
    userId: user.userId,
    sessionId: created.sessionId,
    assistantMessageId: created.assistantMessageId,
    providerId: created.providerId,
    providerApiKey: body.providerApiKey ?? undefined,
    model: created.model,
    contexts: body.contexts ?? undefined,
    tools: body.tools ?? undefined,
    localToolDefinitions: body.localToolDefinitions ?? undefined,
    locale: requestLocale
  }, { workspaceId: user.workspaceId });

  return c.json({
    sessionId: created.sessionId,
    userMessageId: created.userMessageId,
    assistantMessageId: created.assistantMessageId,
    streamId: created.streamId,
    jobId
  });
});

/**
 * POST /api/v1/chat/messages/:id/tool-results
 * Push a local-tool result for an assistant message and resume generation when ready.
 */
chatRouter.post(
  '/messages/:id/tool-results',
  requireWorkspaceAccessRole(),
  zValidator('json', toolResultInput),
  async (c) => {
    const user = c.get('user');
    const messageId = c.req.param('id');
    const body = c.req.valid('json');
    const requestLocale = resolveLocaleFromHeaders({
      appLocaleHeader: c.req.header('x-app-locale'),
      acceptLanguageHeader: c.req.header('accept-language')
    });

    const msg = await chatService.getMessageForUser(messageId, user.userId);
    if (!msg) return c.json({ error: 'Message not found' }, 404);
    if (msg.role !== 'assistant') {
      return c.json({ error: 'Only assistant messages accept tool results' }, 400);
    }

    try {
      const accepted = await chatService.acceptLocalToolResult({
        assistantMessageId: messageId,
        toolCallId: body.toolCallId,
        result: body.result
      });

      if (!accepted.readyToResume) {
        return c.json({
          ok: true,
          accepted: true,
          resumed: false,
          waitingForToolCallIds: accepted.waitingForToolCallIds
        });
      }

      const jobId = await queueManager.addJob(
        'chat_message',
        {
          userId: user.userId,
          sessionId: msg.sessionId,
          assistantMessageId: messageId,
          localToolDefinitions: accepted.localToolDefinitions,
          resumeFrom: accepted.resumeFrom,
          locale: requestLocale
        },
        { workspaceId: user.workspaceId }
      );

      return c.json({
        ok: true,
        accepted: true,
        resumed: true,
        jobId
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to accept tool result';
      return c.json({ error: message }, 400);
    }
  }
);
