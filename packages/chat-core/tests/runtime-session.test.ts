/**
 * BR14b Lot 15.5 — Lot 14b composer unit tests
 * (getSessionBootstrap / getSessionHistory / getMessageRuntimeDetails).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ChatRuntime } from '../src/runtime.js';
import type {
  ChatBootstrapStreamEvent,
  ChatRuntimeDeps,
  ChatSessionDocumentItem,
} from '../src/runtime.js';
import type { ChatState } from '../src/types.js';
import {
  InMemoryCheckpointStore,
  InMemoryMessageStore,
  InMemoryMeshDispatch,
  InMemorySessionStore,
  InMemoryStreamBuffer,
} from '../src/in-memory/index.js';

const sessionId = 'session-1';
const userId = 'user-1';

const buildFixture = (overrides: Partial<ChatRuntimeDeps> = {}) => {
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

  sessionStore.seed({
    id: sessionId,
    userId,
    workspaceId: 'ws-1',
    primaryContextType: null,
    primaryContextId: null,
    title: 'My session',
    createdAt: new Date('2026-05-01T00:00:00Z'),
    updatedAt: new Date('2026-05-02T00:00:00Z'),
  });
  messageStore.seedSession(sessionId, userId);

  return {
    runtime: new ChatRuntime(deps),
    messageStore,
    sessionStore,
    streamBuffer,
    checkpointStore,
  };
};

const seedConversation = async (
  messageStore: InMemoryMessageStore,
): Promise<void> => {
  await messageStore.insertMany([
    {
      id: 'msg-user',
      sessionId,
      role: 'user',
      content: 'Hello',
      sequence: 1,
      createdAt: new Date('2026-05-01T01:00:00Z'),
    },
    {
      id: 'msg-assistant',
      sessionId,
      role: 'assistant',
      content: 'Hi there',
      sequence: 2,
      createdAt: new Date('2026-05-01T01:00:01Z'),
    },
  ]);
};

describe('ChatRuntime.getSessionBootstrap (Lot 14b)', () => {
  it('composes messages + checkpoints + documents + assistantDetails', async () => {
    const docs: ChatSessionDocumentItem[] = [
      {
        id: 'doc-1',
        context_type: 'chat_session',
        context_id: sessionId,
        filename: 'spec.pdf',
        mime_type: 'application/pdf',
        size_bytes: 1234,
        status: 'ready',
      },
    ];
    const assistantDetails: Record<string, ChatBootstrapStreamEvent[]> = {
      'msg-assistant': [
        {
          eventType: 'content_delta',
          data: { delta: 'Hi there' },
          sequence: 1,
          createdAt: new Date('2026-05-01T01:00:01Z'),
        },
      ],
    };
    const fixture = buildFixture({
      listSessionDocuments: async () => docs,
      listAssistantDetailsByMessageId: async () => assistantDetails,
    });
    await seedConversation(fixture.messageStore);

    const bootstrap = await fixture.runtime.getSessionBootstrap({
      sessionId,
      userId,
    });

    expect(bootstrap.messages).toHaveLength(2);
    expect(bootstrap.checkpoints).toEqual([]);
    expect(bootstrap.documents).toEqual(docs);
    expect(bootstrap.assistantDetailsByMessageId).toEqual(assistantDetails);
  });

  it('rejects when the session does not belong to the user', async () => {
    const fixture = buildFixture();
    await expect(
      fixture.runtime.getSessionBootstrap({ sessionId, userId: 'other-user' }),
    ).rejects.toThrow('Session not found');
  });
});

describe('ChatRuntime.getSessionHistory (Lot 14b)', () => {
  it('projects a timeline using buildChatHistoryTimeline', async () => {
    const fixture = buildFixture({
      listAssistantDetailsByMessageId: async () => ({
        'msg-assistant': [
          {
            eventType: 'content_delta',
            data: { delta: 'Hi there' },
            sequence: 1,
            createdAt: new Date('2026-05-01T01:00:01Z'),
          },
        ],
      }),
    });
    await seedConversation(fixture.messageStore);

    const history = await fixture.runtime.getSessionHistory({
      sessionId,
      userId,
    });

    expect(history.sessionId).toBe(sessionId);
    expect(history.title).toBe('My session');
    expect(history.items.length).toBeGreaterThan(0);
  });

  it('uses summary detail mode by default (events stripped)', async () => {
    const fixture = buildFixture({
      listAssistantDetailsByMessageId: async () => ({
        'msg-assistant': [
          {
            eventType: 'content_delta',
            data: { delta: 'Hi there' },
            sequence: 1,
            createdAt: new Date('2026-05-01T01:00:01Z'),
          },
        ],
      }),
    });
    await seedConversation(fixture.messageStore);

    const summary = await fixture.runtime.getSessionHistory({
      sessionId,
      userId,
    });
    const summarySegment = summary.items.find(
      (item) => item.kind === 'assistant-segment',
    );
    expect(summarySegment).toBeDefined();
    if (summarySegment && summarySegment.kind === 'assistant-segment') {
      expect(summarySegment.segment.events).toEqual([]);
    }
  });
});

describe('ChatRuntime.getMessageRuntimeDetails (Lot 14b)', () => {
  it('returns timeline items for an assistant message', async () => {
    const fixture = buildFixture({
      listAssistantDetailsByMessageId: async () => ({
        'msg-assistant': [
          {
            eventType: 'content_delta',
            data: { delta: 'Hi there' },
            sequence: 1,
            createdAt: new Date('2026-05-01T01:00:01Z'),
          },
        ],
      }),
    });
    await seedConversation(fixture.messageStore);

    const details = await fixture.runtime.getMessageRuntimeDetails({
      messageId: 'msg-assistant',
      userId,
    });
    expect(details.messageId).toBe('msg-assistant');
    expect(Array.isArray(details.items)).toBe(true);
  });

  it('rejects for user messages', async () => {
    const fixture = buildFixture();
    await seedConversation(fixture.messageStore);
    await expect(
      fixture.runtime.getMessageRuntimeDetails({
        messageId: 'msg-user',
        userId,
      }),
    ).rejects.toThrow('Runtime details only exist for assistant messages');
  });

  it('rejects when message belongs to another user', async () => {
    const fixture = buildFixture();
    await seedConversation(fixture.messageStore);
    await expect(
      fixture.runtime.getMessageRuntimeDetails({
        messageId: 'msg-assistant',
        userId: 'other-user',
      }),
    ).rejects.toThrow('Message not found');
  });

  it('uses listSessionDocuments callback for bootstrap', async () => {
    const listDocs = vi.fn(async () => []);
    const fixture = buildFixture({ listSessionDocuments: listDocs });
    await seedConversation(fixture.messageStore);
    await fixture.runtime.getSessionBootstrap({ sessionId, userId });
    expect(listDocs).toHaveBeenCalledWith({
      sessionId,
      workspaceId: 'ws-1',
    });
  });
});
