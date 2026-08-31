import { randomUUID } from 'node:crypto';
import { Hono, type Context } from 'hono';

export type ChatRouteMode = 'app-contract' | 'canonical';

export type ChatMessageAttachmentInput = {
  kind: 'image' | 'file';
  source: 'context_document' | 'external_url';
  documentId?: string;
  fileName?: string;
  mimeType?: string;
  sizeBytes?: number;
  url?: string;
  width?: number;
  height?: number;
  data?: Record<string, unknown>;
};

export type ChatControlAction =
  | 'createMessage'
  | 'createSession'
  | 'stop'
  | 'steer'
  | 'feedback'
  | 'retry'
  | 'toolResults'
  | 'editMessage'
  | 'upsertToolPermission'
  | 'deleteToolPermission'
  | 'createCheckpoint'
  | 'listCheckpoints'
  | 'restoreCheckpoint';

export type ChatServerUser = {
  userId: string;
  workspaceId?: string | null;
  role?: string;
};

/**
 * Capability gate for privileged request-body fields.
 *
 * `createChatServer` reads a small set of privileged fields straight from the
 * request body: `providerApiKey`, `localToolDefinitions`, `vscodeCodeAgent`,
 * and the `tools` allowlist. On a trusted mount (e.g. an authenticated API
 * behind a session), accepting these from the client is fine. On a PUBLIC
 * mount, a client could inject its own provider key, arbitrary local-tool
 * definitions, or a vscode agent.
 *
 * This option lets the host opt into a deny-by-default posture per field.
 *
 * Semantics:
 * - The DEFAULT (option omitted, or any field left `undefined`) is PERMISSIVE
 *   and preserves today's behavior exactly: every accept flag is `true` and
 *   `allowedTools` is `'all'`. A trusted mount that omits `capabilities` is
 *   byte-for-byte unchanged.
 * - When a flag is `false`, the corresponding body field is IGNORED (not
 *   rejected): the request still succeeds, but the server falls back to its
 *   own configuration (the provider key the messages/queue ports resolve from
 *   server config; no local tool definitions; no vscode agent). Ignoring is
 *   safer than 400-ing — a public client cannot probe the gate by error code,
 *   and a denied provider key transparently uses the server key.
 * - `allowedTools` is an allowlist applied to the CLIENT-REQUESTED `tools`
 *   field only: when set to a string array, any client-requested tool not on
 *   the list is STRIPPED before reaching the queue. `'all'` disables stripping.
 *   It does NOT cap server/context/workspace tools that the host's own queue
 *   or generation layer may add downstream — those are the host's concern.
 * - Local tools have two independent knobs. `acceptClientLocalToolDefinitions`
 *   gates the client SOURCE (whether `body.localToolDefinitions` is read at
 *   all); `allowedLocalTools` is a NAME allowlist applied to the merged result.
 *   The mount can also DECLARE its own definitions via
 *   {@link ChatServerOptions.localToolDefinitions} — always advertised, taking
 *   precedence over a client definition of the same name. A public mount that
 *   wants exactly one host tool sets `acceptClientLocalToolDefinitions:false`,
 *   declares it in `localToolDefinitions`, and optionally pins
 *   `allowedLocalTools` to its name. EXECUTION of local tools is always
 *   host-side (the browser's local-tool machine); these knobs only control what
 *   the model is TOLD it can call.
 */
export type ChatServerCapabilities = {
  /** Accept `providerApiKey` from the request body. Default: `true`. */
  acceptClientProviderApiKey?: boolean;
  /** Accept `localToolDefinitions` from the request body. Default: `true`. */
  acceptClientLocalToolDefinitions?: boolean;
  /** Accept `vscodeCodeAgent` from the request body. Default: `true`. */
  acceptClientVscodeAgent?: boolean;
  /**
   * Allowlist applied to the client-requested `tools` field. `'all'` (default)
   * accepts any client-requested tool; a string array strips every
   * client-requested tool not on the list. Does not cap server-side tools the
   * host adds downstream.
   */
  allowedTools?: string[] | 'all';
  /**
   * Allowlist applied by NAME to local-tool definitions (both client-supplied
   * and server-declared via {@link ChatServerOptions.localToolDefinitions}).
   * `'all'` (default) advertises every definition; a string array drops every
   * definition whose `name` is not on the list (a definition without a usable
   * `name` cannot pass a name allowlist and is dropped). This is the local-tool
   * counterpart of `allowedTools`: a public mount can advertise exactly one
   * local tool (e.g. `['render_mermaid']`) while ignoring whatever the client
   * tries to add. Independent of `acceptClientLocalToolDefinitions` — that flag
   * gates the client SOURCE, this allowlist gates the resulting NAMES.
   */
  allowedLocalTools?: string[] | 'all';
};

type ResolvedCapabilities = {
  acceptClientProviderApiKey: boolean;
  acceptClientLocalToolDefinitions: boolean;
  acceptClientVscodeAgent: boolean;
  allowedTools: ReadonlySet<string> | 'all';
  allowedLocalTools: ReadonlySet<string> | 'all';
};

export type ChatServerOptions = {
  routes: ChatRouteMode;
  basePath?: string;
  includeControls?: boolean;
  authorize?: (input: {
    user: ChatServerUser;
    action: ChatControlAction;
  }) => boolean | Promise<boolean>;
  /**
   * Deny-by-default capability gate for privileged request-body fields.
   * Omit for the permissive default (today's behavior). See
   * {@link ChatServerCapabilities}.
   */
  capabilities?: ChatServerCapabilities;
  /**
   * Local-tool definitions DECLARED BY THE MOUNT — always advertised to the
   * model regardless of the request body. Each entry must carry a string
   * `name`. Use together with `capabilities.acceptClientLocalToolDefinitions:
   * false` (and optionally `capabilities.allowedLocalTools`) to expose a fixed
   * set of local tools on a PUBLIC mount without trusting the client: the host
   * declares e.g. `render_mermaid` here, the client cannot add others. A
   * server-declared definition takes precedence over a client definition of the
   * same `name`. Default: none (client is the only source, as today).
   */
  localToolDefinitions?: ReadonlyArray<unknown>;
  /** Maximum rows returned by `GET /sessions?scope=all`. Default: 200. */
  allWorkspaceSessionLimit?: number;
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

export type ChatServerMessageIdentity = Pick<
  ChatServerMessage,
  'id' | 'sessionId' | 'role' | 'sequence'
>;

export type ChatServerStreamEvent = {
  streamId: string;
  eventType: string;
  data: unknown;
  sequence: number;
  messageId?: string | null;
  createdAt?: string | Date;
};

export type ChatSessionPort = {
  listSessions(input: {
    userId: string;
    workspaceId?: string | null;
    limit?: number;
  }): Promise<ReadonlyArray<unknown>>;
  createSession(input: {
    userId: string;
    workspaceId?: string | null;
    primaryContextType?: string | null;
    primaryContextId?: string | null;
    title?: string | null;
  }): Promise<{ sessionId: string }>;
  getSessionHistory(input: {
    sessionId: string;
    userId: string;
    detailMode: 'summary' | 'full';
  }): Promise<{
    sessionId: string;
    title: string | null;
    todoRuntime: unknown;
    checkpoints: ReadonlyArray<unknown>;
    documents: ReadonlyArray<unknown>;
    items: ReadonlyArray<unknown>;
  }>;
  deleteSession(input: { sessionId: string; userId: string }): Promise<void>;
};

export type ChatExtensionPermission = {
  toolName: string;
  origin: string;
  policy: 'allow' | 'deny';
  updatedAt: string;
};

export type ChatExtensionPort = {
  listToolPermissions(input: {
    userId: string;
    workspaceId: string;
  }): Promise<ReadonlyArray<ChatExtensionPermission>>;
  upsertToolPermission(input: {
    userId: string;
    workspaceId: string;
    toolName: string;
    origin: string;
    policy: 'allow' | 'deny';
  }): Promise<ChatExtensionPermission>;
  deleteToolPermission(input: {
    userId: string;
    workspaceId: string;
    toolName: string;
    origin: string;
  }): Promise<void>;
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
    attachments?: ChatMessageAttachmentInput[] | null;
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

  getMessageRuntimeDetails?(input: {
    messageId: string;
    userId: string;
  }): Promise<unknown>;

  updateUserMessageContent?(input: {
    messageId: string;
    userId: string;
    content: string;
  }): Promise<{ messageId: string }>;

  getMessageForUser?(input: {
    messageId: string;
    userId: string;
  }): Promise<ChatServerMessageIdentity | null>;

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

  readStreamEvents?(input: {
    streamId: string;
    userId: string;
    sinceSequence?: number;
  }): Promise<ChatServerStreamEvent[]>;

  isStreamAllowed?(input: {
    streamId: string;
    userId: string;
    workspaceId?: string | null;
  }): Promise<boolean>;
};

export type ChatServerDeps = {
  getUser?: (c: Context) => ChatServerUser | null | Promise<ChatServerUser | null>;
  messages: ChatMessagePort;
  sessions?: ChatSessionPort;
  extensions?: ChatExtensionPort;
  queue: ChatQueuePort;
  stream: ChatStreamPort;
};

type InMemoryCreateMessageInput = Parameters<
  ChatMessagePort['createUserMessageWithAssistantPlaceholder']
>[0];
type InMemoryEnqueueInput = Parameters<ChatQueuePort['enqueueChatMessage']>[0];

type InMemoryOptions = {
  assistantReply?: string;
  user?: ChatServerUser;
  /**
   * Optional capture hooks so tests can assert exactly what reached the ports
   * after the capability gate (e.g. that a denied `providerApiKey` did not
   * reach `createUserMessageWithAssistantPlaceholder`/`enqueueChatMessage`).
   */
  onCreateMessage?: (input: InMemoryCreateMessageInput) => void;
  onEnqueue?: (input: InMemoryEnqueueInput) => void;
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

function resolveCapabilities(
  capabilities: ChatServerCapabilities | undefined,
): ResolvedCapabilities {
  const allowedTools = capabilities?.allowedTools;
  const allowedLocalTools = capabilities?.allowedLocalTools;
  return {
    acceptClientProviderApiKey: capabilities?.acceptClientProviderApiKey ?? true,
    acceptClientLocalToolDefinitions:
      capabilities?.acceptClientLocalToolDefinitions ?? true,
    acceptClientVscodeAgent: capabilities?.acceptClientVscodeAgent ?? true,
    allowedTools:
      allowedTools === undefined || allowedTools === 'all'
        ? 'all'
        : new Set(allowedTools),
    allowedLocalTools:
      allowedLocalTools === undefined || allowedLocalTools === 'all'
        ? 'all'
        : new Set(allowedLocalTools),
  };
}

/**
 * Drops client-requested tools that are not on the allowlist (`'all'` = no
 * filtering). When the client requested tools but none survive the allowlist,
 * returns `[]` (an explicit empty set) rather than `undefined`, so a queue
 * adapter that treats `undefined` as "use default tools" cannot be tricked
 * into re-adding the very tools the allowlist denied.
 */
function gateTools(
  tools: string[] | undefined,
  allowedTools: ReadonlySet<string> | 'all',
): string[] | undefined {
  if (tools === undefined) return undefined;
  if (allowedTools === 'all') return tools;
  return tools.filter((tool) => allowedTools.has(tool));
}

/** Extract a usable `name` from a local-tool definition, or `undefined`. */
function localToolDefinitionName(def: unknown): string | undefined {
  if (def && typeof def === 'object') {
    const name = (def as { name?: unknown }).name;
    if (typeof name === 'string' && name.length > 0) return name;
  }
  return undefined;
}

/**
 * Resolves the local-tool definitions advertised to the model by merging the
 * mount's server-declared definitions with the (already source-gated) client
 * definitions, then applying the `allowedLocalTools` name allowlist.
 *
 * - Permissive fast-path: when the mount declares no server-side definitions
 *   AND sets no name allowlist (`'all'`), the client definitions pass through
 *   BYTE-FOR-BYTE — identical to the pre-0.3.0 behavior (no dedup, no reorder).
 * - Otherwise: server-declared definitions are canonical and take precedence
 *   over a client definition of the same `name`; definitions whose name is not
 *   on the allowlist are dropped; a nameless definition cannot satisfy a name
 *   allowlist and is dropped. Returns `undefined` when nothing survives, so a
 *   queue adapter treating `undefined` as "no local tools" is not handed `[]`.
 */
function resolveLocalToolDefinitions(
  serverDefs: ReadonlyArray<unknown>,
  clientDefs: ReadonlyArray<unknown> | undefined,
  allowedLocalTools: ReadonlySet<string> | 'all',
): unknown[] | undefined {
  if (serverDefs.length === 0 && allowedLocalTools === 'all') {
    return clientDefs === undefined ? undefined : [...clientDefs];
  }
  const passes = (def: unknown): boolean => {
    if (allowedLocalTools === 'all') return true;
    const name = localToolDefinitionName(def);
    return name !== undefined && allowedLocalTools.has(name);
  };
  const result: unknown[] = [];
  const seen = new Set<string>();
  for (const def of [...serverDefs, ...(clientDefs ?? [])]) {
    if (!passes(def)) continue;
    const name = localToolDefinitionName(def);
    if (name !== undefined) {
      if (seen.has(name)) continue;
      seen.add(name);
    }
    result.push(def);
  }
  return result.length > 0 ? result : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function parseAttachments(value: unknown): ChatMessageAttachmentInput[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const attachments = value
    .slice(0, 16)
    .map((item): ChatMessageAttachmentInput | null => {
      if (!item || typeof item !== 'object') return null;
      const record = item as Record<string, unknown>;
      const kind = record.kind === 'file' ? 'file' : record.kind === 'image' ? 'image' : null;
      if (!kind) return null;
      const source = record.source === 'external_url' ? 'external_url' : 'context_document';
      const documentId = stringValue(record.documentId) ?? undefined;
      const url = stringValue(record.url) ?? undefined;
      if (source === 'context_document' && !documentId) return null;
      if (source === 'external_url' && !url) return null;
      const mimeType = stringValue(record.mimeType) ?? undefined;
      if (kind === 'image' && mimeType && !mimeType.toLowerCase().startsWith('image/')) {
        return null;
      }
      const data =
        record.data && typeof record.data === 'object'
          ? (record.data as Record<string, unknown>)
          : undefined;
      const attachment: ChatMessageAttachmentInput = { kind, source };
      if (documentId !== undefined) attachment.documentId = documentId;
      const fileName = stringValue(record.fileName) ?? undefined;
      if (fileName !== undefined) attachment.fileName = fileName;
      if (mimeType !== undefined) attachment.mimeType = mimeType;
      const sizeBytes = numberValue(record.sizeBytes);
      if (sizeBytes !== undefined) attachment.sizeBytes = sizeBytes;
      if (url !== undefined) attachment.url = url;
      const width = numberValue(record.width);
      if (width !== undefined) attachment.width = width;
      const height = numberValue(record.height);
      if (height !== undefined) attachment.height = height;
      if (data !== undefined) attachment.data = data;
      return attachment;
    })
    .filter((item): item is ChatMessageAttachmentInput => item !== null);
  return attachments.length > 0 ? attachments : undefined;
}

function resolveLocale(c: Context): string | undefined {
  return c.req.header('x-app-locale') ?? c.req.header('accept-language') ?? undefined;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function controlErrorResponse(c: Context, error: unknown, fallback: string): Response {
  const message = errorMessage(error, fallback);
  const status = message === 'Message not found' ? 404 : 400;
  return c.json({ error: message }, status);
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

export async function readAppContractStreamEvents(
  stream: ChatStreamPort,
  input: {
    streamId: string;
    userId: string;
    workspaceId?: string | null;
    sinceSequence?: number;
  },
): Promise<ChatServerStreamEvent[]> {
  const allowed = stream.isStreamAllowed
    ? await stream.isStreamAllowed({
        streamId: input.streamId,
        userId: input.userId,
        workspaceId: input.workspaceId,
      })
    : true;
  if (!allowed) return [];
  if (!stream.readStreamEvents) {
    throw new Error('app-contract stream replay requires readStreamEvents');
  }
  return stream.readStreamEvents({
    streamId: input.streamId,
    userId: input.userId,
    sinceSequence: input.sinceSequence,
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
  const capabilities = resolveCapabilities(options.capabilities);
  const serverLocalToolDefinitions = options.localToolDefinitions ?? [];

  app.use('*', async (c, next) => {
    if (c.req.header('sec-sentropic-wire-version')) {
      return c.json({ error: 'Sec-Sentropic-Wire-Version is not supported' }, 400);
    }
    await next();
  });

  const authorize = async (
    c: Context,
    user: ChatServerUser,
    action: ChatControlAction,
  ): Promise<Response | null> => {
    if (!options.authorize) return null;
    try {
      const allowed = await options.authorize({ user, action });
      return allowed ? null : c.json({ error: 'Insufficient permissions' }, 403);
    } catch {
      return c.json({ error: 'Insufficient permissions' }, 403);
    }
  };

  const postMessage = async (c: Context, pathSessionId?: string) => {
    const user = await resolveUser(c, deps);
    const denied = await authorize(c, user, 'createMessage');
    if (denied) return denied;
    const body = await readJson(c);
    const content = stringValue(body.content);
    const attachments = parseAttachments(body.attachments);
    if (!content && !attachments) {
      return c.json({ error: 'content or attachments is required' }, 400);
    }

    // Capability gate: privileged body fields are ignored when their flag is
    // denied (server config takes over), and tools are filtered by allowlist.
    const clientProviderApiKey = capabilities.acceptClientProviderApiKey
      ? stringValue(body.providerApiKey)
      : null;
    const clientLocalToolDefinitions =
      capabilities.acceptClientLocalToolDefinitions &&
      Array.isArray(body.localToolDefinitions)
        ? body.localToolDefinitions
        : undefined;
    const localToolDefinitions = resolveLocalToolDefinitions(
      serverLocalToolDefinitions,
      clientLocalToolDefinitions,
      capabilities.allowedLocalTools,
    );
    const clientVscodeAgent = capabilities.acceptClientVscodeAgent
      ? body.vscodeCodeAgent
      : undefined;
    const gatedTools = gateTools(parseStringArray(body.tools), capabilities.allowedTools);

    const created = await deps.messages.createUserMessageWithAssistantPlaceholder({
      userId: user.userId,
      sessionId: pathSessionId ?? stringValue(body.sessionId),
      content: content ?? '',
      providerId: stringValue(body.providerId),
      providerApiKey: clientProviderApiKey,
      model: stringValue(body.model),
      workspaceId: user.workspaceId ?? null,
      primaryContextType: stringValue(body.primaryContextType),
      primaryContextId: stringValue(body.primaryContextId),
      contexts: parseContexts(body.contexts),
      attachments,
      sessionTitle: stringValue(body.sessionTitle),
    });

    const jobId = await deps.queue.enqueueChatMessage(
      {
        userId: user.userId,
        sessionId: created.sessionId,
        assistantMessageId: created.assistantMessageId,
        providerId: created.providerId ?? null,
        providerApiKey: clientProviderApiKey ?? undefined,
        model: created.model ?? null,
        contexts: parseContexts(body.contexts),
        tools: gatedTools,
        localToolDefinitions,
        vscodeCodeAgent: clientVscodeAgent,
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
    const denied = await authorize(c, user, 'stop');
    if (denied) return denied;
    const assistantMessageId = routeParam(c, 'messageId', 'id');
    try {
      const result = deps.messages.stopAssistantMessage
        ? await deps.messages.stopAssistantMessage({
            assistantMessageId,
            userId: user.userId,
          })
        : { ok: true as const, jobId: null };
      return c.json(result);
    } catch (error) {
      return controlErrorResponse(c, error, 'Unable to stop message');
    }
  };

  const steer = async (c: Context) => {
    const user = await resolveUser(c, deps);
    const denied = await authorize(c, user, 'steer');
    if (denied) return denied;
    const assistantMessageId = routeParam(c, 'messageId', 'id');
    const body = await readJson(c);
    const message = stringValue(body.message);
    if (!message) return c.json({ error: 'message is required' }, 400);
    const metadata =
      body.metadata && typeof body.metadata === 'object'
        ? (body.metadata as Record<string, unknown>)
        : {};
    try {
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
    } catch (error) {
      return controlErrorResponse(c, error, 'Unable to steer message');
    }
  };

  const feedback = async (c: Context) => {
    const user = await resolveUser(c, deps);
    const denied = await authorize(c, user, 'feedback');
    if (denied) return denied;
    const messageId = routeParam(c, 'messageId', 'id');
    const body = await readJson(c);
    const vote = body.vote;
    if (vote !== 'up' && vote !== 'down' && vote !== 'clear') {
      return c.json({ error: 'Invalid feedback payload' }, 400);
    }
    try {
      const result = deps.messages.setMessageFeedback
        ? await deps.messages.setMessageFeedback({ messageId, userId: user.userId, vote })
        : { messageId, vote: vote === 'up' ? 1 : vote === 'down' ? -1 : null };
      return c.json(result);
    } catch (error) {
      return controlErrorResponse(c, error, 'Unable to set feedback');
    }
  };

  const retry = async (c: Context) => {
    const user = await resolveUser(c, deps);
    const denied = await authorize(c, user, 'retry');
    if (denied) return denied;
    const messageId = routeParam(c, 'messageId', 'id');
    const body = await readJson(c);
    if (!deps.messages.retryUserMessage) {
      return c.json({ error: 'retry is not configured' }, 501);
    }
    try {
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
          vscodeCodeAgent: capabilities.acceptClientVscodeAgent
            ? body.vscodeCodeAgent
            : undefined,
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
    } catch (error) {
      return controlErrorResponse(c, error, 'Unable to retry message');
    }
  };

  const toolResults = async (c: Context) => {
    const user = await resolveUser(c, deps);
    const denied = await authorize(c, user, 'toolResults');
    if (denied) return denied;
    const assistantMessageId = routeParam(c, 'messageId', 'id');
    const body = await readJson(c);
    const toolCallId = stringValue(body.toolCallId);
    if (!toolCallId) return c.json({ error: 'toolCallId is required' }, 400);
    if (!deps.messages.acceptLocalToolResult) {
      return c.json({ error: 'tool results are not configured' }, 501);
    }
    try {
      const assistant = deps.messages.getMessageForUser
        ? await deps.messages.getMessageForUser({
            messageId: assistantMessageId,
            userId: user.userId,
          })
        : null;
      if (deps.messages.getMessageForUser) {
        if (!assistant) return c.json({ error: 'Message not found' }, 404);
        if (assistant.role !== 'assistant') {
          return c.json({ error: 'Only assistant messages accept tool results' }, 400);
        }
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

      // `accepted.*` come from the trusted messages port (not the client body)
      // and stay ungated; only the `body.vscodeCodeAgent` fallback is
      // client-sourced and must pass the capability gate.
      const fallbackVscodeAgent = capabilities.acceptClientVscodeAgent
        ? body.vscodeCodeAgent
        : undefined;
      const jobId = await deps.queue.enqueueChatMessage(
        {
          userId: user.userId,
          sessionId: assistant?.sessionId ?? '',
          assistantMessageId,
          localToolDefinitions: accepted.localToolDefinitions,
          vscodeCodeAgent: accepted.vscodeCodeAgent ?? fallbackVscodeAgent,
          resumeFrom: accepted.resumeFrom,
          locale: resolveLocale(c),
        },
        { workspaceId: user.workspaceId ?? null },
      );
      return c.json({ ok: true, accepted: true, resumed: true, jobId });
    } catch (error) {
      return controlErrorResponse(c, error, 'Unable to accept tool result');
    }
  };

  const createCheckpoint = async (c: Context) => {
    const user = await resolveUser(c, deps);
    const denied = await authorize(c, user, 'createCheckpoint');
    if (denied) return denied;
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
    const denied = await authorize(c, user, 'listCheckpoints');
    if (denied) return denied;
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
    const denied = await authorize(c, user, 'restoreCheckpoint');
    if (denied) return denied;
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
      createUserMessageWithAssistantPlaceholder: (input) => {
        options.onCreateMessage?.(input);
        return createAssistantForUserMessage(input);
      },
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
        options.onEnqueue?.(input);
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
      async readStreamEvents(input) {
        return (streamEvents.get(input.streamId) ?? [])
          .filter((event) => event.sequence > (input.sinceSequence ?? 0))
          .sort((a, b) => a.sequence - b.sequence);
      },
      async isStreamAllowed() {
        return true;
      },
    },
  };

  return deps;
}
