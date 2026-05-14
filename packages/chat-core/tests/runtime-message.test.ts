/**
 * BR14b Lot 15.5 — ChatRuntime message-orchestration unit tests.
 * Covers Lot 13 (setMessageFeedback / updateUserMessageContent) and
 * Lot 14a (listMessages with optional hydration callback).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ChatRuntime } from '../src/runtime.js';
import type { ChatRuntimeDeps } from '../src/runtime.js';
import type { ChatState } from '../src/types.js';
import {
  InMemoryCheckpointStore,
  InMemoryMessageStore,
  InMemoryMeshDispatch,
  InMemorySessionStore,
  InMemoryStreamBuffer,
} from '../src/in-memory/index.js';

const buildFixture = (
  overrides: Partial<ChatRuntimeDeps> = {},
): {
  runtime: ChatRuntime;
  messageStore: InMemoryMessageStore;
  sessionStore: InMemorySessionStore;
} => {
  const messageStore = new InMemoryMessageStore();
  const sessionStore = new InMemorySessionStore();
  const streamBuffer = new InMemoryStreamBuffer();
  const checkpointStore = new InMemoryCheckpointStore<ChatState>();
  const mesh = new InMemoryMeshDispatch();
  const deps: ChatRuntimeDeps = {
    messageStore,
    sessionStore,
    streamBuffer,
    checkpointStore,
    mesh,
    normalizeVsCodeCodeAgent: () => null,
    resolveModelSelection: async () => ({
      provider_id: 'openai',
      model_id: 'gpt-test',
    }),
    normalizeMessageContexts: () => [],
    isChatContextType: () => false,
    resolveSessionWorkspaceId: async (session) => session.workspaceId ?? null,
    listSessionDocuments: async () => [],
    listAssistantDetailsByMessageId: async () => ({}),
    resolveWorkspaceAccess: async () => ({
      readOnly: false,
      canWrite: true,
      currentUserRole: 'editor',
    }),
    ...overrides,
  };
  return {
    runtime: new ChatRuntime(deps),
    messageStore,
    sessionStore,
  };
};

const sessionId = 'session-1';
const userId = 'user-1';

const seed = (
  fixture: { messageStore: InMemoryMessageStore; sessionStore: InMemorySessionStore },
) => {
  fixture.sessionStore.seed({
    id: sessionId,
    userId,
    workspaceId: 'ws-1',
    primaryContextType: null,
    primaryContextId: null,
    title: 'Test session',
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  fixture.messageStore.seedSession(sessionId, userId);
};

describe('ChatRuntime.setMessageFeedback (Lot 13)', () => {
  let fixture: ReturnType<typeof buildFixture>;
  beforeEach(() => {
    fixture = buildFixture();
    seed(fixture);
  });
  afterEach(() => {
    fixture.messageStore.reset();
    fixture.sessionStore.reset();
  });

  it('records an up-vote on an assistant message', async () => {
    await fixture.messageStore.insertMany([
      {
        id: 'msg-1',
        sessionId,
        role: 'assistant',
        content: 'hi',
        sequence: 1,
        createdAt: new Date(),
      },
    ]);
    const result = await fixture.runtime.setMessageFeedback({
      messageId: 'msg-1',
      userId,
      vote: 'up',
    });
    expect(result).toEqual({ vote: 1 });

    // Vote persists across listForSessionWithFeedback.
    const list = await fixture.messageStore.listForSessionWithFeedback(
      sessionId,
      userId,
    );
    expect(list[0].feedbackVote).toBe(1);
  });

  it('clears feedback when vote=clear', async () => {
    await fixture.messageStore.insertMany([
      {
        id: 'msg-1',
        sessionId,
        role: 'assistant',
        content: 'hi',
        sequence: 1,
        createdAt: new Date(),
      },
    ]);
    await fixture.runtime.setMessageFeedback({ messageId: 'msg-1', userId, vote: 'down' });
    const cleared = await fixture.runtime.setMessageFeedback({
      messageId: 'msg-1',
      userId,
      vote: 'clear',
    });
    expect(cleared).toEqual({ vote: null });
  });

  it('rejects feedback on a user message', async () => {
    await fixture.messageStore.insertMany([
      {
        id: 'msg-1',
        sessionId,
        role: 'user',
        content: 'hi',
        sequence: 1,
        createdAt: new Date(),
      },
    ]);
    await expect(
      fixture.runtime.setMessageFeedback({ messageId: 'msg-1', userId, vote: 'up' }),
    ).rejects.toThrow('Feedback is only allowed on assistant messages');
  });

  it('rejects feedback for unknown message', async () => {
    await expect(
      fixture.runtime.setMessageFeedback({ messageId: 'unknown', userId, vote: 'up' }),
    ).rejects.toThrow('Message not found');
  });
});

describe('ChatRuntime.updateUserMessageContent (Lot 13)', () => {
  let fixture: ReturnType<typeof buildFixture>;
  beforeEach(() => {
    fixture = buildFixture();
    seed(fixture);
  });
  afterEach(() => {
    fixture.messageStore.reset();
    fixture.sessionStore.reset();
  });

  it('rewrites user content and bumps session updatedAt', async () => {
    await fixture.messageStore.insertMany([
      {
        id: 'msg-1',
        sessionId,
        role: 'user',
        content: 'before',
        sequence: 1,
        createdAt: new Date(),
      },
    ]);
    const previousUpdatedAt = (
      await fixture.sessionStore.findForUser(sessionId, userId)
    )?.updatedAt;

    await new Promise((resolve) => setTimeout(resolve, 5));
    await fixture.runtime.updateUserMessageContent({
      messageId: 'msg-1',
      userId,
      content: 'after',
    });

    const refreshed = await fixture.messageStore.findById('msg-1');
    expect(refreshed?.content).toBe('after');
    const session = await fixture.sessionStore.findForUser(sessionId, userId);
    expect(session?.updatedAt).not.toEqual(previousUpdatedAt);
  });

  it('rejects edits on assistant messages', async () => {
    await fixture.messageStore.insertMany([
      {
        id: 'msg-1',
        sessionId,
        role: 'assistant',
        content: 'before',
        sequence: 1,
        createdAt: new Date(),
      },
    ]);
    await expect(
      fixture.runtime.updateUserMessageContent({
        messageId: 'msg-1',
        userId,
        content: 'after',
      }),
    ).rejects.toThrow('Only user messages can be edited');
  });
});

describe('ChatRuntime.listMessages (Lot 14a)', () => {
  it('hydrates todoRuntime via the callback when present', async () => {
    const hydrate = vi.fn(async () => ({ activeTodos: 2 }));
    const fixture = buildFixture({ hydrateMessagesWithTodoRuntime: hydrate });
    seed(fixture);
    await fixture.messageStore.insertMany([
      {
        id: 'msg-1',
        sessionId,
        role: 'user',
        content: 'hi',
        sequence: 1,
        createdAt: new Date(),
      },
    ]);

    const result = await fixture.runtime.listMessages(sessionId, userId);
    expect(result.messages).toHaveLength(1);
    expect(result.todoRuntime).toEqual({ activeTodos: 2 });
    expect(hydrate).toHaveBeenCalledTimes(1);
  });

  it('returns todoRuntime: null when callback is undefined', async () => {
    const fixture = buildFixture();
    seed(fixture);
    await fixture.messageStore.insertMany([
      {
        id: 'msg-1',
        sessionId,
        role: 'user',
        content: 'hi',
        sequence: 1,
        createdAt: new Date(),
      },
    ]);

    const result = await fixture.runtime.listMessages(sessionId, userId);
    expect(result.todoRuntime).toBeNull();
  });

  it('rejects when session does not belong to user', async () => {
    const fixture = buildFixture();
    seed(fixture);
    await expect(
      fixture.runtime.listMessages(sessionId, 'other-user'),
    ).rejects.toThrow('Session not found');
  });
});
