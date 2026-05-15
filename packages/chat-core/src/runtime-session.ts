/**
 * BR14b Lot 22b-2 — Second step of the `ChatRuntime` god-class split.
 *
 * `ChatRuntimeSession` owns the four read-only session/messages view
 * methods (`listMessages` / `getSessionBootstrap` / `getSessionHistory`
 * / `getMessageRuntimeDetails`) that were migrated into `ChatRuntime`
 * in BR14b Lot 14a (`listMessages`) and Lot 14b (the three view
 * composers). The bodies are a VERBATIM move from `runtime.ts`; only
 * the surrounding class changes.
 *
 * Pattern: reuses the Lot 22b-1 façade shape exactly. Each sub-class
 * receives the same `ChatRuntimeDeps` by reference (no copy, no state
 * duplication). The `ChatRuntime` façade instantiates one of these per
 * `ChatRuntime` and delegates the public view methods through one-line
 * wrappers. All public method signatures on `ChatRuntime` stay byte-
 * for-byte identical so that `chat-service.ts` call sites and the 17
 * session+message unit tests
 * (`tests/runtime-session.test.ts` + `tests/runtime-message.test.ts`)
 * continue to work unchanged.
 *
 * Per Lot 22b-0 Section D inventory — `getSessionBootstrap` and
 * `getSessionHistory` both call `this.listCheckpoints` (a method that
 * lives in `ChatRuntimeCheckpoint`, Lot 22b-1). To preserve the
 * behavior byte-for-byte without duplicating the checkpoint body, the
 * constructor accepts the sibling `ChatRuntimeCheckpoint` instance and
 * routes the cross-sub-class call through it. The 3 in-Session calls
 * to `this.listMessages` (`getSessionBootstrap`, `getSessionHistory`,
 * `getMessageRuntimeDetails`) stay in-class — `listMessages` is owned
 * by Session itself, no cross-class hop needed.
 */
import type {
  ChatMessageWithFeedback,
} from './message-port.js';
import type {
  ChatRuntimeDeps,
  GetMessageRuntimeDetailsOptions,
  GetMessageRuntimeDetailsResult,
  GetSessionBootstrapOptions,
  GetSessionBootstrapResult,
  GetSessionHistoryOptions,
  GetSessionHistoryResult,
} from './runtime.js';
import {
  buildAssistantMessageHistoryDetails,
  buildChatHistoryTimeline,
  compactChatHistoryTimelineForSummary,
  type ChatHistoryMessage,
  type ChatHistoryStreamEvent,
} from './history.js';
import type { ChatRuntimeCheckpoint } from './runtime-checkpoint.js';

export class ChatRuntimeSession {
  constructor(
    private readonly deps: ChatRuntimeDeps,
    private readonly checkpoint: ChatRuntimeCheckpoint,
  ) {}

  /**
   * BR14b Lot 14a — verbatim port of `ChatService.listMessages`.
   * Returns the ordered message list (with feedback votes) and the
   * hydrated todoRuntime payload for the session. Authz check
   * (`Session not found`) preserved at the runtime entry; persistence
   * delegated to the `SessionStore` + `MessageStore` ports; todoRuntime
   * hydration delegated to the optional
   * `hydrateMessagesWithTodoRuntime` callback. When the callback is
   * undefined the runtime returns `todoRuntime: null`, matching the
   * legacy behavior of sessions without an addressable workspace.
   *
   * Differences from the pre-Lot 14a chat-service body are limited to:
   *   (a) `this.getSessionForUser` → `this.deps.sessionStore.findForUser`;
   *   (b) `postgresChatMessageStore.listForSessionWithFeedback` →
   *       `this.deps.messageStore.listForSessionWithFeedback`;
   *   (c) the `resolveSessionWorkspaceId` + `getWorkspaceRole` +
   *       `todoOrchestrationService.getSessionTodoRuntime` triplet →
   *       `this.deps.hydrateMessagesWithTodoRuntime({ session, userId })`.
   */
  async listMessages(
    sessionId: string,
    userId: string,
  ): Promise<{
    messages: ChatMessageWithFeedback[];
    todoRuntime: Record<string, unknown> | null;
  }> {
    const session = await this.deps.sessionStore.findForUser(sessionId, userId);
    if (!session) throw new Error('Session not found');

    const messages = await this.deps.messageStore.listForSessionWithFeedback(
      sessionId,
      userId,
    );

    const todoRuntime: Record<string, unknown> | null = this.deps
      .hydrateMessagesWithTodoRuntime
      ? await this.deps.hydrateMessagesWithTodoRuntime({ session, userId })
      : null;

    return {
      messages,
      todoRuntime,
    };
  }

  /**
   * BR14b Lot 14b — verbatim port of `ChatService.getSessionBootstrap`.
   * Composes `SessionStore.findForUser` (authz precheck) +
   * `this.listMessages` (Lot 14a) + `this.listCheckpoints` (Lot 11) +
   * `deps.resolveSessionWorkspaceId` + `deps.listSessionDocuments` +
   * `deps.listAssistantDetailsByMessageId` callbacks (Lot 14b).
   *
   * Differences from the pre-Lot 14b chat-service body are limited to:
   *   (a) `this.getSessionForUser` → `this.deps.sessionStore.findForUser`;
   *   (b) `this.listMessages` → `this.listMessages` (runtime own method);
   *   (c) `this.listCheckpoints({sessionId, userId, limit})` →
   *       `this.listCheckpoints({sessionId, limit})` because the runtime
   *       method does not re-do the authz check; the composer guards
   *       upfront via `findForUser`;
   *   (d) `this.resolveSessionWorkspaceId` →
   *       `this.deps.resolveSessionWorkspaceId`;
   *   (e) `this.listSessionDocuments` → `this.deps.listSessionDocuments`;
   *   (f) `this.listAssistantDetailsByMessageId` →
   *       `this.deps.listAssistantDetailsByMessageId`.
   *
   * Post Lot 22b-2: `this.listCheckpoints` is dispatched through the
   * sibling `ChatRuntimeCheckpoint` instance owned by the façade and
   * passed by reference at construction time. Behavior unchanged.
   */
  async getSessionBootstrap(
    options: GetSessionBootstrapOptions,
  ): Promise<GetSessionBootstrapResult> {
    const session = await this.deps.sessionStore.findForUser(
      options.sessionId,
      options.userId,
    );
    if (!session) throw new Error('Session not found');

    const [{ messages, todoRuntime }, checkpoints, workspaceId] = await Promise.all([
      this.listMessages(options.sessionId, options.userId),
      this.checkpoint.listCheckpoints({
        sessionId: options.sessionId,
        limit: 20,
      }),
      this.deps.resolveSessionWorkspaceId(session, options.userId),
    ]);

    const documents = await this.deps.listSessionDocuments({
      sessionId: options.sessionId,
      workspaceId,
    });
    const assistantMessageIds = messages
      .filter((message) => message.role === 'assistant')
      .map((message) => String(message.id ?? '').trim())
      .filter((messageId) => messageId.length > 0);
    const assistantDetailsByMessageId =
      await this.deps.listAssistantDetailsByMessageId(assistantMessageIds);

    return {
      messages,
      todoRuntime,
      checkpoints,
      documents,
      assistantDetailsByMessageId,
    };
  }

  /**
   * BR14b Lot 14b — verbatim port of `ChatService.getSessionHistory`.
   * Composes the same persistence pieces as `getSessionBootstrap` plus
   * the pure history projection helpers
   * (`buildChatHistoryTimeline` + `compactChatHistoryTimelineForSummary`)
   * moved into `packages/chat-core/src/history.ts` in the same lot.
   *
   * Differences from the pre-Lot 14b chat-service body match
   * `getSessionBootstrap` plus:
   *   (g) `buildChatHistoryTimeline` /
   *       `compactChatHistoryTimelineForSummary` resolve from
   *       `./history.js` (chat-core) instead of `./chat-session-history`
   *       (the api re-export shim keeps existing api-side callers
   *       working).
   *
   * Post Lot 22b-2: `this.listCheckpoints` is dispatched through the
   * sibling `ChatRuntimeCheckpoint` instance owned by the façade and
   * passed by reference at construction time. Behavior unchanged.
   */
  async getSessionHistory(
    options: GetSessionHistoryOptions,
  ): Promise<GetSessionHistoryResult> {
    const session = await this.deps.sessionStore.findForUser(
      options.sessionId,
      options.userId,
    );
    if (!session) throw new Error('Session not found');

    const [{ messages, todoRuntime }, checkpoints, workspaceId] = await Promise.all([
      this.listMessages(options.sessionId, options.userId),
      this.checkpoint.listCheckpoints({
        sessionId: options.sessionId,
        limit: 20,
      }),
      this.deps.resolveSessionWorkspaceId(session, options.userId),
    ]);

    const documents = await this.deps.listSessionDocuments({
      sessionId: options.sessionId,
      workspaceId,
    });
    const assistantMessageIds = messages
      .filter((message) => message.role === 'assistant')
      .map((message) => String(message.id ?? '').trim())
      .filter((messageId) => messageId.length > 0);
    const assistantDetailsByMessageId =
      await this.deps.listAssistantDetailsByMessageId(assistantMessageIds);
    const eventMap = new Map<string, ChatHistoryStreamEvent[]>();
    for (const [messageId, events] of Object.entries(assistantDetailsByMessageId)) {
      eventMap.set(messageId, events as ChatHistoryStreamEvent[]);
    }
    const projectedItems = buildChatHistoryTimeline(
      messages as ChatHistoryMessage[],
      eventMap,
    );
    const items =
      options.detailMode === 'full'
        ? projectedItems
        : compactChatHistoryTimelineForSummary(projectedItems);

    return {
      sessionId: options.sessionId,
      title: session.title ?? null,
      todoRuntime,
      checkpoints,
      documents,
      items: [...items].reverse(),
    };
  }

  /**
   * BR14b Lot 14b — verbatim port of
   * `ChatService.getMessageRuntimeDetails`. Composes
   * `MessageStore.findDetailedForUser` (authz + role precheck) +
   * `this.listMessages` (Lot 14a) +
   * `deps.listAssistantDetailsByMessageId` callback (Lot 14b) + the
   * pure projection helpers from `./history.js`.
   *
   * Differences from the pre-Lot 14b chat-service body are limited to:
   *   (a) `this.getDetailedMessageForUser` →
   *       `this.deps.messageStore.findDetailedForUser`;
   *   (b) `this.listMessages` → `this.listMessages` (runtime own method);
   *   (c) `this.listAssistantDetailsByMessageId` →
   *       `this.deps.listAssistantDetailsByMessageId`;
   *   (d) `buildChatHistoryTimeline` /
   *       `buildAssistantMessageHistoryDetails` resolve from
   *       `./history.js` (chat-core) instead of `./chat-session-history`.
   */
  async getMessageRuntimeDetails(
    options: GetMessageRuntimeDetailsOptions,
  ): Promise<GetMessageRuntimeDetailsResult> {
    const message = await this.deps.messageStore.findDetailedForUser(
      options.messageId,
      options.userId,
    );
    if (!message) throw new Error('Message not found');
    if (message.role !== 'assistant') {
      throw new Error('Runtime details only exist for assistant messages');
    }

    const { messages } = await this.listMessages(
      message.sessionId,
      options.userId,
    );
    const details = await this.deps.listAssistantDetailsByMessageId([options.messageId]);
    const events = (details[options.messageId] ?? []) as ChatHistoryStreamEvent[];
    const eventMap = new Map<string, ChatHistoryStreamEvent[]>();
    eventMap.set(options.messageId, events);
    const projected = buildChatHistoryTimeline(
      messages as ChatHistoryMessage[],
      eventMap,
    );
    const firstIndex = projected.findIndex(
      (item) => String(item.message.id ?? '').trim() === options.messageId,
    );
    const lastIndex = (() => {
      for (let index = projected.length - 1; index >= 0; index -= 1) {
        if (String(projected[index]?.message.id ?? '').trim() === options.messageId) {
          return index;
        }
      }
      return -1;
    })();
    const items =
      firstIndex >= 0 && lastIndex >= firstIndex
        ? projected.slice(firstIndex, lastIndex + 1)
        : buildAssistantMessageHistoryDetails(
            message as ChatHistoryMessage,
            events,
          );

    return {
      messageId: options.messageId,
      items,
    };
  }
}
