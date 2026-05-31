import { randomUUID } from 'node:crypto';
import { Hono, type Context } from 'hono';

export type ChatRouteMode = 'app-contract' | 'canonical';

export type ChatServerUser = {
  userId: string;
  workspaceId?: string | null;
  role?: string;
};

export type ChatServerOptions = {
  routes: ChatRouteMode;
  basePath?: string;
  includeControls?: boolean;
};

export type CreatedChatMessage = {
  sessionId: string;
  userMessageId: string;
  assistantMessageId: string;
  streamId: string;
  providerId?: string | null;
  model?: string | null;
};

export type ChatServerMessage = {
  id: string;
  sessionId: string;
  role: string;
  content: string | null;
  contexts?: unknown;
  sequence: number;
  createdAt: string | Date;
  feedbackVote?: number | null;
  model?: string | null;
};

export type ChatServerStreamEvent = {
  streamId: string;
  eventType: string;
  data: unknown;
  sequence: number;
  messageId?: string | null;
  createdAt?: string | Date;
};

export type ChatMessagePort = {
  createUserMessageWithAssistantPlaceholder(input: {
    userId: string;
    sessionId?: string | null;
    content: string;
    providerId?: string | null;
    providerApiKey?: string | null;
    model?: string | null;
    workspaceId?: string | null;
    primaryContextType?: string | null;
    primaryContextId?: string | null;
    contexts?: Array<{ contextType: string; contextId: string }>;
    sessionTitle?: string | null;
  }): Promise<CreatedChatMessage>;

  listMessages(input: {
    sessionId: string;
    userId: string;
  }): Promise<{
    messages: ReadonlyArray<ChatServerMessage>;
    todoRuntime: Record<string, unknown> | null;
  }>;

  getSessionBootstrap(input: {
    sessionId: string;
    userId: string;
  }): Promise<{
    messages: ReadonlyArray<ChatServerMessage>;
    todoRuntime: Record<string, unknown> | null;
    checkpoints: ReadonlyArray<unknown>;
    documents: ReadonlyArray<unknown>;
    assistantDetailsByMessageId: Record<string, ReadonlyArray<unknown>>;
  }>;

  getMessageForUser?(input: {
    messageId: string;
    userId: string;
  }): Promise<ChatServerMessage | null>;

  stopAssistantMessage?(input: {
    assistantMessageId: string;
    userId: string;
  }): Promise<{ ok: true; jobId: string | null }>;

  steerAssistantMessage?(input: {
    assistantMessageId: string;
    userId: string;
    message: string;
    metadata?: Record<string, unknown>;
  }): Promise<unknown>;

  setMessageFeedback?(input: {
    messageId: string;
    userId: string;
    vote: 'up' | 'down' | 'clear';
  }): Promise<{ messageId: string; vote: number | null }>;

  retryUserMessage?(input: {
    messageId: string;
    userId: string;
    providerId?: string | null;
    model?: string | null;
  }): Promise<CreatedChatMessage>;

  acceptLocalToolResult?(input: {
    assistantMessageId: string;
    toolCallId: string;
    result: unknown;
  }): Promise<{
    readyToResume: boolean;
    waitingForToolCallIds: string[];
    localToolDefinitions: unknown[];
    vscodeCodeAgent?: unknown;
    resumeFrom?: unknown;
  }>;

  createCheckpoint?(input: {
    sessionId: string;
    userId: string;
    title?: string | null;
    anchorMessageId?: string | null;
  }): Promise<unknown>;

  listCheckpoints?(input: {
    sessionId: string;
    userId: string;
    limit?: number;
  }): Promise<unknown[]>;

  restoreCheckpoint?(input: {
    sessionId: string;
    checkpointId: string;
    userId: string;
  }): Promise<unknown>;
};

export type ChatQueuePort = {
  enqueueChatMessage(
    input: {
      userId: string;
      sessionId: string;
      assistantMessageId: string;
      providerId?: string | null;
      providerApiKey?: string;
      model?: string | null;
      contexts?: Array<{ contextType: string; contextId: string }>;
      tools?: string[];
      localToolDefinitions?: unknown[];
      vscodeCodeAgent?: unknown;
      resumeFrom?: unknown;
      locale?: string;
    },
    options?: { workspaceId?: string | null },
  ): Promise<string>;
};

export type ChatStreamPort = {
  readSessionEvents(input: {
    sessionId: string;
    userId: string;
    fromSeq?: number;
  }): Promise<ChatServerStreamEvent[]>;
};

export type ChatServerDeps = {
  getUser?: (c: Context) => ChatServerUser | null | Promise<ChatServerUser | null>;
  messages: ChatMessagePort;
  queue: ChatQueuePort;
  stream: ChatStreamPort;
};

type InMemoryOptions = {
  assistantReply?: string;
  user?: ChatServerUser;
};

function assertDeps(deps: ChatServerDeps): void {
  if (!deps || typeof deps !== 'object') {
    throw new Error('chat-server deps are required');
  }
  if (!deps.messages || !deps.queue || !deps.stream) {
    throw new Error('chat-server deps must include messages, queue, and stream ports');
  }
}

function assertRoutes(routes: unknown): asserts routes is ChatRouteMode {
  if (routes !== 'app-contract' && routes !== 'canonical') {
    throw new Error('chat-server routes must be app-contract or canonical');
  }
}

function normalizeBasePath(value: string | undefined): string {
  if (value === '') return '';
  const raw = value ?? '/chat';
  const prefixed = raw.startsWith('/') ? raw : `/${raw}`;
  return prefixed.endsWith('/') ? prefixed.slice(0, -1) : prefixed;
}

async function readJson(c: Context): Promise<Record<string, unknown>> {
  try {
    const body = (await c.req.json()) as unknown;
    return body && typeof body === 'object'
      ? (body as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null;
}

function parseContexts(value: unknown): Array<{ contextType: string; contextId: string }> | undefined {
  if (!Array.isArray(value)) return undefined;
  const contexts = value
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const record = item as Record<string, unknown>;
      const contextType = stringValue(record.contextType);
      const contextId = stringValue(record.contextId);
      return contextType && contextId ? { contextType, contextId } : null;
    })
    .filter((item): item is { contextType: string; contextId: string } => item !== null);
  return contexts.length > 0 ? contexts : undefined;
}

function parseStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const values = value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item) => item.length > 0);
  return values.length > 0 ? values : undefined;
}

function resolveLocale(c: Context): string | undefined {
  return c.req.header('x-app-locale') ?? c.req.header('accept-language') ?? undefined;
}

function routeParam(c: Context, ...names: string[]): string {
  for (const name of names) {
    const value = c.req.param(name);
    if (value) return value;
  }
  throw new Error(`Missing route parameter: ${names.join(' or ')}`);
}

async function resolveUser(c: Context, deps: ChatServerDeps): Promise<ChatServerUser> {
  const user = deps.getUser ? await deps.getUser(c) : null;
  return user ?? { userId: 'anonymous', workspaceId: null };
}

function sseEvent(event: ChatServerStreamEvent): string {
  return [
    `event: ${event.eventType}`,
    `id: ${event.streamId}:${event.sequence}`,
    `data: ${JSON.stringify({
      streamId: event.streamId,
      sequence: event.sequence,
      data: event.data,
    })}`,
    '',
    '',
  ].join('\n');
}

function sseResponse(events: ChatServerStreamEvent[]): Response {
  return new Response(events.map(sseEvent).join(''), {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
    },
  });
}

export function createChatServer(
  deps: ChatServerDeps,
  options: ChatServerOptions,
): Hono {
  assertDeps(deps);
  assertRoutes(options?.routes);

  const app = new Hono();
  const basePath = normalizeBasePath(options.basePath);
  const routePath = (suffix: string) => `${basePath}${suffix}`;
  const includeControls = options.includeControls ?? true;

  app.use('*', async (c, next) => {
    if (c.req.header('sec-sentropic-wire-version')) {
      return c.json({ error: 'Sec-Sentropic-Wire-Version is not supported' }, 400);
    }
    await next();
  });

  const postMessage = async (c: Context, pathSessionId?: string) => {
    const user = await resolveUser(c, deps);
    const body = await readJson(c);
    const content = stringValue(body.content);
    if (!content) return c.json({ error: 'content is required' }, 400);

    const created = await deps.messages.createUserMessageWithAssistantPlaceholder({
      userId: user.userId,
      sessionId: pathSessionId ?? stringValue(body.sessionId),
      content,
      providerId: stringValue(body.providerId),
      providerApiKey: stringValue(body.providerApiKey),
      model: stringValue(body.model),
      workspaceId: user.workspaceId ?? null,
      primaryContextType: stringValue(body.primaryContextType),
      primaryContextId: stringValue(body.primaryContextId),
      contexts: parseContexts(body.contexts),
      sessionTitle: stringValue(body.sessionTitle),
    });

    const jobId = await deps.queue.enqueueChatMessage(
      {
        userId: user.userId,
        sessionId: created.sessionId,
        assistantMessageId: created.assistantMessageId,
        providerId: created.providerId ?? null,
        providerApiKey: stringValue(body.providerApiKey) ?? undefined,
        model: created.model ?? null,
        contexts: parseContexts(body.contexts),
        tools: parseStringArray(body.tools),
        localToolDefinitions: Array.isArray(body.localToolDefinitions)
          ? body.localToolDefinitions
          : undefined,
        vscodeCodeAgent: body.vscodeCodeAgent,
        locale: resolveLocale(c),
      },
      { workspaceId: user.workspaceId ?? null },
    );

    return c.json({
      sessionId: created.sessionId,
      userMessageId: created.userMessageId,
      assistantMessageId: created.assistantMessageId,
      streamId: created.streamId,
      jobId,
    });
  };

  const listMessages = async (c: Context) => {
    const user = await resolveUser(c, deps);
    const sessionId = routeParam(c, 'sessionId', 'id');
    const result = await deps.messages.listMessages({
      sessionId,
      userId: user.userId,
    });
    return c.json({ sessionId, ...result });
  };

  const bootstrap = async (c: Context) => {
    const user = await resolveUser(c, deps);
    const sessionId = routeParam(c, 'sessionId', 'id');
    const result = await deps.messages.getSessionBootstrap({
      sessionId,
      userId: user.userId,
    });
    return c.json({ sessionId, ...result });
  };

  const stream = async (c: Context) => {
    const user = await resolveUser(c, deps);
    const sessionId = routeParam(c, 'sessionId', 'id');
    const rawFromSeq = Number(c.req.query('fromSeq') ?? 0);
    const fromSeq = Number.isFinite(rawFromSeq) ? rawFromSeq : 0;
    const events = await deps.stream.readSessionEvents({
      sessionId,
      userId: user.userId,
      fromSeq,
    });
    return sseResponse(events);
  };

  const stop = async (c: Context) => {
    const user = await resolveUser(c, deps);
    const assistantMessageId = routeParam(c, 'messageId', 'id');
    const result = deps.messages.stopAssistantMessage
      ? await deps.messages.stopAssistantMessage({
          assistantMessageId,
          userId: user.userId,
        })
      : { ok: true as const, jobId: null };
    return c.json(result);
  };

  const steer = async (c: Context) => {
    const user = await resolveUser(c, deps);
    const assistantMessageId = routeParam(c, 'messageId', 'id');
    const body = await readJson(c);
    const message = stringValue(body.message);
    if (!message) return c.json({ error: 'message is required' }, 400);
    const metadata =
      body.metadata && typeof body.metadata === 'object'
        ? (body.metadata as Record<string, unknown>)
        : {};
    const result = deps.messages.steerAssistantMessage
      ? await deps.messages.steerAssistantMessage({
          assistantMessageId,
          userId: user.userId,
          message,
          metadata,
        })
      : {
          assistantMessageId,
          status: 'accepted',
          action: 'interrupt_relaunch',
          steer: { messageId: null, message, metadata },
        };
    return c.json(result);
  };

  const feedback = async (c: Context) => {
    const user = await resolveUser(c, deps);
    const messageId = routeParam(c, 'messageId', 'id');
    const body = await readJson(c);
    const vote = body.vote === 'down' || body.vote === 'clear' ? body.vote : 'up';
    const result = deps.messages.setMessageFeedback
      ? await deps.messages.setMessageFeedback({ messageId, userId: user.userId, vote })
      : { messageId, vote: vote === 'up' ? 1 : vote === 'down' ? -1 : null };
    return c.json(result);
  };

  const retry = async (c: Context) => {
    const user = await resolveUser(c, deps);
    const messageId = routeParam(c, 'messageId', 'id');
    const body = await readJson(c);
    if (!deps.messages.retryUserMessage) {
      return c.json({ error: 'retry is not configured' }, 501);
    }
    const created = await deps.messages.retryUserMessage({
      messageId,
      userId: user.userId,
      providerId: stringValue(body.providerId),
      model: stringValue(body.model),
    });
    const jobId = await deps.queue.enqueueChatMessage(
      {
        userId: user.userId,
        sessionId: created.sessionId,
        assistantMessageId: created.assistantMessageId,
        providerId: created.providerId ?? null,
        model: created.model ?? null,
        vscodeCodeAgent: body.vscodeCodeAgent,
        locale: resolveLocale(c),
      },
      { workspaceId: user.workspaceId ?? null },
    );
    return c.json({ ...created, jobId });
  };

  const toolResults = async (c: Context) => {
    const user = await resolveUser(c, deps);
    const assistantMessageId = routeParam(c, 'messageId', 'id');
    const body = await readJson(c);
    const toolCallId = stringValue(body.toolCallId);
    if (!toolCallId) return c.json({ error: 'toolCallId is required' }, 400);
    if (!deps.messages.acceptLocalToolResult) {
      return c.json({ error: 'tool results are not configured' }, 501);
    }
    const accepted = await deps.messages.acceptLocalToolResult({
      assistantMessageId,
      toolCallId,
      result: body.result,
    });
    if (!accepted.readyToResume) {
      return c.json({
        ok: true,
        accepted: true,
        resumed: false,
        waitingForToolCallIds: accepted.waitingForToolCallIds,
      });
    }
    const assistant = deps.messages.getMessageForUser
      ? await deps.messages.getMessageForUser({
          messageId: assistantMessageId,
          userId: user.userId,
        })
      : null;
    if (!assistant) return c.json({ error: 'Message not found' }, 404);

    const jobId = await deps.queue.enqueueChatMessage(
      {
        userId: user.userId,
        sessionId: assistant?.sessionId ?? '',
        assistantMessageId,
        localToolDefinitions: accepted.localToolDefinitions,
        vscodeCodeAgent: accepted.vscodeCodeAgent ?? body.vscodeCodeAgent,
        resumeFrom: accepted.resumeFrom,
        locale: resolveLocale(c),
      },
      { workspaceId: user.workspaceId ?? null },
    );
    return c.json({ ok: true, accepted: true, resumed: true, jobId });
  };

  const createCheckpoint = async (c: Context) => {
    const user = await resolveUser(c, deps);
    const sessionId = routeParam(c, 'sessionId', 'id');
    const body = await readJson(c);
    if (!deps.messages.createCheckpoint) {
      return c.json({ error: 'checkpoints are not configured' }, 501);
    }
    const checkpoint = await deps.messages.createCheckpoint({
      sessionId,
      userId: user.userId,
      title: stringValue(body.title),
      anchorMessageId: stringValue(body.anchorMessageId),
    });
    return c.json({ sessionId, checkpoint });
  };

  const listCheckpoints = async (c: Context) => {
    const user = await resolveUser(c, deps);
    const sessionId = routeParam(c, 'sessionId', 'id');
    const limit = Number(c.req.query('limit') ?? 20);
    const checkpoints = deps.messages.listCheckpoints
      ? await deps.messages.listCheckpoints({
          sessionId,
          userId: user.userId,
          limit: Number.isFinite(limit) ? limit : 20,
        })
      : [];
    return c.json({ sessionId, checkpoints });
  };

  const restoreCheckpoint = async (c: Context) => {
    const user = await resolveUser(c, deps);
    const sessionId = routeParam(c, 'sessionId', 'id');
    const checkpointId = routeParam(c, 'checkpointId');
    if (!deps.messages.restoreCheckpoint) {
      return c.json({ error: 'checkpoints are not configured' }, 501);
    }
    const restored = await deps.messages.restoreCheckpoint({
      sessionId,
      checkpointId,
      userId: user.userId,
    });
    return c.json({ sessionId, ...(restored as Record<string, unknown>) });
  };

  if (options.routes === 'canonical') {
    app.post(routePath('/sessions/:sessionId/messages'), (c) =>
      postMessage(c, c.req.param('sessionId')),
    );
    app.get(routePath('/sessions/:sessionId/messages'), listMessages);
    app.get(routePath('/sessions/:sessionId/bootstrap'), bootstrap);
    app.get(routePath('/sessions/:sessionId/stream'), stream);
    if (includeControls) {
      app.post(routePath('/sessions/:sessionId/checkpoints'), createCheckpoint);
      app.get(routePath('/sessions/:sessionId/checkpoints'), listCheckpoints);
      app.post(routePath('/sessions/:sessionId/checkpoints/:checkpointId/restore'), restoreCheckpoint);
    }
  } else {
    app.post(routePath('/messages'), (c) => postMessage(c));
    app.get(routePath('/sessions/:sessionId/messages'), listMessages);
    app.get(routePath('/sessions/:sessionId/bootstrap'), bootstrap);
    if (includeControls) {
      app.post(routePath('/sessions/:sessionId/checkpoints'), createCheckpoint);
      app.get(routePath('/sessions/:sessionId/checkpoints'), listCheckpoints);
      app.post(routePath('/sessions/:sessionId/checkpoints/:checkpointId/restore'), restoreCheckpoint);
    }
  }

  if (includeControls) {
    app.post(routePath('/messages/:messageId/stop'), stop);
    app.post(routePath('/messages/:messageId/steer'), steer);
    app.post(routePath('/messages/:messageId/feedback'), feedback);
    app.post(routePath('/messages/:messageId/retry'), retry);
    app.post(routePath('/messages/:messageId/tool-results'), toolResults);
  }

  return app;
}

export function createInMemoryChatServerDeps(
  options: InMemoryOptions = {},
): ChatServerDeps {
  const user = options.user ?? { userId: 'test-user', workspaceId: 'test-workspace' };
  const assistantReply = options.assistantReply ?? 'Hello from chat-server.';
  const sessions = new Map<string, { id: string; userId: string; workspaceId: string | null }>();
  const messages = new Map<string, ChatServerMessage>();
  const streamEvents = new Map<string, ChatServerStreamEvent[]>();
  const checkpoints = new Map<string, Array<Record<string, unknown>>>();

  const ensureSession = (sessionId: string, owner: ChatServerUser) => {
    if (!sessions.has(sessionId)) {
      sessions.set(sessionId, {
        id: sessionId,
        userId: owner.userId,
        workspaceId: owner.workspaceId ?? null,
      });
    }
    return sessions.get(sessionId)!;
  };

  const listSessionMessages = (sessionId: string) =>
    Array.from(messages.values())
      .filter((message) => message.sessionId === sessionId)
      .sort((a, b) => a.sequence - b.sequence);

  const nextSequence = (sessionId: string) => listSessionMessages(sessionId).length + 1;

  const appendEvent = (
    streamId: string,
    eventType: string,
    data: unknown,
    sequence: number,
    messageId?: string | null,
  ) => {
    const event: ChatServerStreamEvent = {
      streamId,
      eventType,
      data,
      sequence,
      messageId: messageId ?? streamId,
      createdAt: new Date(0).toISOString(),
    };
    const existing = streamEvents.get(streamId) ?? [];
    existing.push(event);
    streamEvents.set(streamId, existing);
    return event;
  };

  const createAssistantForUserMessage = async (
    input: Parameters<ChatMessagePort['createUserMessageWithAssistantPlaceholder']>[0],
    reuseUserMessageId?: string,
  ): Promise<CreatedChatMessage> => {
    const sessionId = input.sessionId ?? randomUUID();
    ensureSession(sessionId, { userId: input.userId, workspaceId: input.workspaceId });

    const userMessageId = reuseUserMessageId ?? randomUUID();
    const userSequence = reuseUserMessageId
      ? messages.get(reuseUserMessageId)?.sequence ?? nextSequence(sessionId)
      : nextSequence(sessionId);
    if (!reuseUserMessageId) {
      messages.set(userMessageId, {
        id: userMessageId,
        sessionId,
        role: 'user',
        content: input.content,
        contexts: input.contexts,
        sequence: userSequence,
        createdAt: new Date(0).toISOString(),
        feedbackVote: null,
      });
    }

    const assistantMessageId = randomUUID();
    messages.set(assistantMessageId, {
      id: assistantMessageId,
      sessionId,
      role: 'assistant',
      content: null,
      sequence: userSequence + 1,
      createdAt: new Date(0).toISOString(),
      feedbackVote: null,
      model: input.model ?? null,
    });

    return {
      sessionId,
      userMessageId,
      assistantMessageId,
      streamId: assistantMessageId,
      providerId: input.providerId ?? null,
      model: input.model ?? null,
    };
  };

  const deps: ChatServerDeps = {
    getUser: () => user,
    messages: {
      createUserMessageWithAssistantPlaceholder: (input) =>
        createAssistantForUserMessage(input),
      async listMessages(input) {
        ensureSession(input.sessionId, { userId: input.userId, workspaceId: null });
        return {
          messages: listSessionMessages(input.sessionId),
          todoRuntime: null,
        };
      },
      async getSessionBootstrap(input) {
        ensureSession(input.sessionId, { userId: input.userId, workspaceId: null });
        const sessionMessages = listSessionMessages(input.sessionId);
        const assistantDetailsByMessageId: Record<string, ChatServerStreamEvent[]> = {};
        for (const message of sessionMessages) {
          if (message.role !== 'assistant') continue;
          assistantDetailsByMessageId[message.id] = streamEvents.get(message.id) ?? [];
        }
        return {
          messages: sessionMessages,
          todoRuntime: null,
          checkpoints: checkpoints.get(input.sessionId) ?? [],
          documents: [],
          assistantDetailsByMessageId,
        };
      },
      async getMessageForUser(input) {
        return messages.get(input.messageId) ?? null;
      },
      async stopAssistantMessage(input) {
        return { ok: true, jobId: `job_${input.assistantMessageId}` };
      },
      async steerAssistantMessage(input) {
        return {
          assistantMessageId: input.assistantMessageId,
          status: 'accepted',
          action: 'interrupt_relaunch',
          steer: {
            messageId: randomUUID(),
            message: input.message,
            metadata: input.metadata ?? {},
          },
        };
      },
      async setMessageFeedback(input) {
        const message = messages.get(input.messageId);
        const vote = input.vote === 'up' ? 1 : input.vote === 'down' ? -1 : null;
        if (message) {
          messages.set(input.messageId, { ...message, feedbackVote: vote });
        }
        return { messageId: input.messageId, vote };
      },
      async acceptLocalToolResult(input) {
        appendEvent(
          input.assistantMessageId,
          'tool_call_result',
          {
            tool_call_id: input.toolCallId,
            result: input.result,
          },
          (streamEvents.get(input.assistantMessageId)?.length ?? 0) + 1,
          input.assistantMessageId,
        );
        return {
          readyToResume: true,
          waitingForToolCallIds: [],
          localToolDefinitions: [],
          resumeFrom: {
            previousResponseId: 'in_memory_response',
            toolOutputs: [
              {
                callId: input.toolCallId,
                output: JSON.stringify(input.result),
              },
            ],
          },
        };
      },
      async retryUserMessage(input) {
        const userMessage = messages.get(input.messageId);
        if (!userMessage) throw new Error('Message not found');
        for (const message of listSessionMessages(userMessage.sessionId)) {
          if (message.sequence > userMessage.sequence) {
            messages.delete(message.id);
            streamEvents.delete(message.id);
          }
        }
        return createAssistantForUserMessage(
          {
            userId: input.userId,
            sessionId: userMessage.sessionId,
            content: userMessage.content ?? '',
            model: input.model,
            providerId: input.providerId,
          },
          userMessage.id,
        );
      },
      async createCheckpoint(input) {
        const checkpoint = {
          id: randomUUID(),
          title: input.title ?? null,
          restoredToSequence: listSessionMessages(input.sessionId).length,
        };
        const list = checkpoints.get(input.sessionId) ?? [];
        list.unshift(checkpoint);
        checkpoints.set(input.sessionId, list);
        return checkpoint;
      },
      async listCheckpoints(input) {
        return (checkpoints.get(input.sessionId) ?? []).slice(0, input.limit ?? 20);
      },
      async restoreCheckpoint(input) {
        return {
          checkpointId: input.checkpointId,
          restoredToSequence: listSessionMessages(input.sessionId).length,
          removedMessages: 0,
        };
      },
    },
    queue: {
      async enqueueChatMessage(input) {
        const assistant = messages.get(input.assistantMessageId);
        if (assistant) {
          messages.set(input.assistantMessageId, {
            ...assistant,
            content: assistantReply,
            model: input.model ?? assistant.model ?? null,
          });
        }
        appendEvent(
          input.assistantMessageId,
          'content_delta',
          { delta: assistantReply },
          1,
          input.assistantMessageId,
        );
        appendEvent(input.assistantMessageId, 'done', {}, 2, input.assistantMessageId);
        return randomUUID();
      },
    },
    stream: {
      async readSessionEvents(input) {
        const sessionMessages = listSessionMessages(input.sessionId);
        return sessionMessages
          .filter((message) => message.role === 'assistant')
          .flatMap((message) => streamEvents.get(message.id) ?? [])
          .filter((event) => event.sequence > (input.fromSeq ?? 0))
          .sort((a, b) => a.sequence - b.sequence);
      },
    },
  };

  return deps;
}
