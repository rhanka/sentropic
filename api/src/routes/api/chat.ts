import { Hono } from 'hono';
import { z } from 'zod';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { zValidator } from '@hono/zod-validator';
import { createChatServer } from '../../../../packages/chat-server/src/index';
import { chatService, type ChatContextType } from '../../services/chat-service';
import { queueManager, type ChatMessageJobData } from '../../services/queue-manager';
import { writeStreamEventWithSequenceRetry } from '../../services/stream-service';
import type { ProviderId } from '../../services/provider-runtime';
import { requireWorkspaceAccess, requireWorkspaceEditor } from '../../services/workspace-access';
import { db } from '../../db/client';
import { chatMessages, chatSessions, extensionToolPermissions } from '../../db/schema';
import { requireWorkspaceAccessRole, requireWorkspaceEditorRole } from '../../middleware/workspace-rbac';
import { createId } from '../../utils/id';

export const chatRouter = new Hono();

const editMessageInput = z.object({
  content: z.string().min(1)
});

const createSessionInput = z.object({
  primaryContextType: z.enum(['organization', 'folder', 'initiative', 'usecase', 'executive_summary']).optional(),
  primaryContextId: z.string().optional(),
  sessionTitle: z.string().optional()
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

const toProviderId = (value: string | null | undefined): ProviderId | undefined =>
  value ? (value as ProviderId) : undefined;

const toProviderIdOrNull = (value: string | null | undefined): ProviderId | null =>
  value ? (value as ProviderId) : null;

const toChatContexts = (
  contexts: Array<{ contextType: string; contextId: string }> | undefined,
): Array<{ contextType: ChatContextType; contextId: string }> | undefined =>
  contexts?.map((context) => ({
    contextType: context.contextType as ChatContextType,
    contextId: context.contextId,
  }));

async function stopAssistantMessageForUser(input: {
  assistantMessageId: string;
  userId: string;
}): Promise<{ ok: true; jobId: string | null }> {
  const msg = await chatService.getMessageForUser(input.assistantMessageId, input.userId);
  if (!msg) throw new Error('Message not found');
  if (msg.role !== 'assistant') throw new Error('Only assistant messages can be stopped');

  const rows = (await db.all(sql`
    SELECT id, status
    FROM job_queue
    WHERE type = 'chat_message'
      AND (data::jsonb->>'assistantMessageId') = ${input.assistantMessageId}
      AND (data::jsonb->>'userId') = ${input.userId}
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
      assistantMessageId: input.assistantMessageId,
      reason: 'user_stop',
      fallbackContent: 'Réponse interrompue.',
    });
  }

  return { ok: true, jobId: jobId ?? null };
}

async function steerAssistantMessageForUser(input: {
  assistantMessageId: string;
  userId: string;
  message: string;
  metadata?: Record<string, unknown>;
}): Promise<{
  assistantMessageId: string;
  status: 'accepted';
  action: 'interrupt_relaunch';
  steer: {
    messageId: string | null;
    message: string;
    metadata: Record<string, unknown>;
  };
}> {
  const msg = await chatService.getMessageForUser(input.assistantMessageId, input.userId);
  if (!msg) throw new Error('Message not found');
  if (msg.role !== 'assistant') {
    throw new Error('Only assistant messages can be steered');
  }

  const metadata = input.metadata ?? {};
  const streamId = input.assistantMessageId;
  await writeStreamEventWithSequenceRetry(
    streamId,
    'status',
    {
      state: 'steer_received',
      message: input.message,
      metadata,
      actor: 'user',
      actorId: input.userId,
    },
    {
      messageId: streamId,
    },
  );

  let steerMessageId: string | null = null;
  try {
    await db.transaction(async (tx) => {
      const insertedSteerMessageId = createId();
      const insertBeforeSequence = msg.sequence;

      await tx
        .update(chatMessages)
        .set({
          sequence: sql`${chatMessages.sequence} + 1`,
        })
        .where(
          and(
            eq(chatMessages.sessionId, msg.sessionId),
            gte(chatMessages.sequence, insertBeforeSequence),
          ),
        );

      await tx.insert(chatMessages).values({
        id: insertedSteerMessageId,
        sessionId: msg.sessionId,
        role: 'user',
        content: input.message,
        toolCalls: null,
        toolCallId: null,
        reasoning: null,
        model: null,
        promptId: null,
        promptVersionId: null,
        contexts: null,
        sequence: insertBeforeSequence,
        createdAt: new Date(),
      });

      await tx
        .update(chatSessions)
        .set({ updatedAt: new Date() })
        .where(eq(chatSessions.id, msg.sessionId));

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
    status: 'accepted',
    action: 'interrupt_relaunch',
    steer: {
      messageId: steerMessageId,
      message: input.message,
      metadata,
    },
  };
}

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

const chatServerRouter = createChatServer(
  {
    getUser: (c) => c.get('user'),
    messages: {
      createUserMessageWithAssistantPlaceholder: (input) =>
        chatService.createUserMessageWithAssistantPlaceholder({
          userId: input.userId,
          sessionId: input.sessionId ?? null,
          content: input.content,
          providerId: toProviderIdOrNull(input.providerId),
          providerApiKey: input.providerApiKey ?? null,
          model: input.model ?? null,
          workspaceId: input.workspaceId ?? null,
          primaryContextType: (input.primaryContextType as ChatContextType | undefined) ?? null,
          primaryContextId: input.primaryContextId ?? null,
          contexts: toChatContexts(input.contexts),
          attachments: input.attachments ?? null,
          sessionTitle: input.sessionTitle ?? null,
        }),
      listMessages: (input) =>
        chatService.listMessages(input.sessionId, input.userId),
      getSessionBootstrap: (input) =>
        chatService.getSessionBootstrap({
          sessionId: input.sessionId,
          userId: input.userId,
        }),
      getMessageForUser: (input) =>
        chatService.getMessageForUser(input.messageId, input.userId),
      stopAssistantMessage: (input) =>
        stopAssistantMessageForUser(input),
      steerAssistantMessage: (input) =>
        steerAssistantMessageForUser(input),
      setMessageFeedback: async (input) => {
        const result = await chatService.setMessageFeedback({
          messageId: input.messageId,
          userId: input.userId,
          vote: input.vote,
        });
        return { messageId: input.messageId, vote: result.vote };
      },
      retryUserMessage: (input) =>
        chatService.retryUserMessage({
          messageId: input.messageId,
          userId: input.userId,
          providerId: toProviderIdOrNull(input.providerId),
          model: input.model ?? null,
        }),
      acceptLocalToolResult: (input) =>
        chatService.acceptLocalToolResult({
          assistantMessageId: input.assistantMessageId,
          toolCallId: input.toolCallId,
          result: input.result,
        }),
      createCheckpoint: (input) =>
        chatService.createCheckpoint({
          sessionId: input.sessionId,
          userId: input.userId,
          title: input.title ?? null,
          anchorMessageId: input.anchorMessageId ?? null,
        }),
      listCheckpoints: (input) =>
        chatService.listCheckpoints({
          sessionId: input.sessionId,
          userId: input.userId,
          limit: input.limit,
        }),
      restoreCheckpoint: (input) =>
        chatService.restoreCheckpoint({
          sessionId: input.sessionId,
          checkpointId: input.checkpointId,
          userId: input.userId,
        }),
    },
    queue: {
      enqueueChatMessage: (input, options) =>
        queueManager.addJob(
          'chat_message',
          {
            userId: input.userId,
            sessionId: input.sessionId,
            assistantMessageId: input.assistantMessageId,
            providerId: toProviderId(input.providerId),
            providerApiKey: input.providerApiKey,
            model: input.model ?? undefined,
            contexts: toChatContexts(input.contexts),
            tools: input.tools,
            localToolDefinitions:
              input.localToolDefinitions as ChatMessageJobData['localToolDefinitions'],
            vscodeCodeAgent: input.vscodeCodeAgent as ChatMessageJobData['vscodeCodeAgent'],
            resumeFrom: input.resumeFrom as ChatMessageJobData['resumeFrom'],
            locale: input.locale,
          },
          { workspaceId: options?.workspaceId ?? undefined },
        ),
    },
    stream: {
      readSessionEvents: async () => [],
    },
  },
  {
    routes: 'app-contract',
    basePath: '',
    includeControls: true,
    authorize: async ({ user, action }) => {
      if (!user.workspaceId) return false;
      if (action === 'restoreCheckpoint') {
        await requireWorkspaceEditor(user.userId, user.workspaceId);
        return true;
      }
      await requireWorkspaceAccess(user.userId, user.workspaceId);
      return true;
    },
  },
);

chatRouter.route('/', chatServerRouter);

chatRouter.get('/sessions', async (c) => {
  const user = c.get('user');
  const sessions = await chatService.listSessions(user.userId, user.workspaceId);
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

chatRouter.get('/sessions/:id/history', async (c) => {
  const user = c.get('user');
  const sessionId = c.req.param('id')!;
  const detailMode =
    c.req.query('runtimeDetails') === 'full' ? 'full' : 'summary';
  let result;
  try {
    result = await chatService.getSessionHistory({
      sessionId,
      userId: user.userId,
      detailMode,
    });
  } catch (e: unknown) {
    if (e instanceof Error && e.message === 'Session not found') {
      return c.json({ message: 'Session not found' }, 404);
    }
    throw e;
  }

  const encoder = new TextEncoder();

  c.header('Content-Type', 'application/x-ndjson; charset=utf-8');
  c.header('Cache-Control', 'no-store');

  return new Response(
    new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(
          encoder.encode(
            `${JSON.stringify({
              type: 'session_meta',
              sessionId: result.sessionId,
              title: result.title,
              todoRuntime: result.todoRuntime,
              checkpoints: result.checkpoints,
              documents: result.documents,
            })}\n`,
          ),
        );
        await new Promise((resolve) => setTimeout(resolve, 0));

        let emitted = 0;
        for (const item of result.items) {
          controller.enqueue(
            encoder.encode(
              `${JSON.stringify({
                type: 'timeline_item',
                item,
              })}\n`,
            ),
          );
          emitted += 1;
          if (emitted % 2 === 0) {
            await new Promise((resolve) => setTimeout(resolve, 0));
          }
        }
        controller.close();
      },
    }),
    { status: 200, headers: c.res.headers },
  );
});

chatRouter.get('/messages/:id/runtime-details', async (c) => {
  const user = c.get('user');
  const messageId = c.req.param('id')!;
  const result = await chatService.getMessageRuntimeDetails({
    messageId,
    userId: user.userId,
  });
  return c.json(result);
});

/**
 * DELETE /api/v1/chat/sessions/:id
 * Supprime une session + cascade (messages, contexts, stream events)
 */
chatRouter.delete('/sessions/:id', async (c) => {
  const user = c.get('user');
  const sessionId = c.req.param('id')!;
  await chatService.deleteSession(sessionId, user.userId);
  return c.json({ ok: true });
});

/**
 * PATCH /api/v1/chat/messages/:id
 * Edit a user message content.
 */
chatRouter.patch('/messages/:id', requireWorkspaceEditorRole(), zValidator('json', editMessageInput), async (c) => {
  const user = c.get('user');
  const messageId = c.req.param('id')!;
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
