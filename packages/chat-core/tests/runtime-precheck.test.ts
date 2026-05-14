/**
 * BR14b Lot 15.5 — prepareAssistantRun (Lot 15) unit tests.
 * Exercises the runAssistantGeneration precheck slice migrated in Lot 15.
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
  InMemoryStreamSequencer,
} from '../src/in-memory/index.js';

const sessionId = 'session-1';
const userId = 'user-1';
const assistantMessageId = 'msg-assistant';

const ALLOWED_CONTEXT_TYPES = new Set(['organization', 'project', 'chat_session']);

const buildFixture = (overrides: Partial<ChatRuntimeDeps> = {}) => {
  const messageStore = new InMemoryMessageStore();
  const sessionStore = new InMemorySessionStore();
  const streamBuffer = new InMemoryStreamBuffer();
  const streamSequencer = new InMemoryStreamSequencer();
  const checkpointStore = new InMemoryCheckpointStore<ChatState>();
  const mesh = new InMemoryMeshDispatch();
  const deps: ChatRuntimeDeps = {
    messageStore,
    sessionStore,
    streamBuffer,
    streamSequencer,
    checkpointStore,
    mesh,
    normalizeVsCodeCodeAgent: () => null,
    resolveModelSelection: async () => ({
      provider_id: 'openai',
      model_id: 'gpt-test',
    }),
    normalizeMessageContexts: () => [],
    isChatContextType: (value: unknown) =>
      typeof value === 'string' && ALLOWED_CONTEXT_TYPES.has(value),
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
    streamBuffer,
    checkpointStore,
  };
};

const seedSession = (
  fixture: ReturnType<typeof buildFixture>,
  workspaceId: string | null = 'ws-1',
) => {
  fixture.sessionStore.seed({
    id: sessionId,
    userId,
    workspaceId,
    primaryContextType: null,
    primaryContextId: null,
    title: 'Test session',
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  fixture.messageStore.seedSession(sessionId, userId);
};

const seedConversation = async (fixture: ReturnType<typeof buildFixture>) => {
  await fixture.messageStore.insertMany([
    {
      id: 'msg-user-1',
      sessionId,
      role: 'user',
      content: 'first question',
      sequence: 1,
      createdAt: new Date('2026-05-01T10:00:00Z'),
    },
    {
      id: 'msg-assistant-1',
      sessionId,
      role: 'assistant',
      content: 'first answer',
      sequence: 2,
      createdAt: new Date('2026-05-01T10:00:01Z'),
    },
    {
      id: 'msg-user-2',
      sessionId,
      role: 'user',
      content: '   second question   ',
      sequence: 3,
      createdAt: new Date('2026-05-01T10:00:02Z'),
    },
    {
      id: assistantMessageId,
      sessionId,
      role: 'assistant',
      content: null,
      sequence: 4,
      createdAt: new Date('2026-05-01T10:00:03Z'),
    },
  ]);
};

describe('ChatRuntime.prepareAssistantRun (Lot 15)', () => {
  let fixture: ReturnType<typeof buildFixture>;
  beforeEach(() => {
    fixture = buildFixture();
    seedSession(fixture);
  });
  afterEach(() => {
    fixture.messageStore.reset();
    fixture.sessionStore.reset();
  });

  it('returns full context including session, workspace flags, messages, conversation', async () => {
    await seedConversation(fixture);
    const context = await fixture.runtime.prepareAssistantRun({
      userId,
      sessionId,
      assistantMessageId,
    });
    expect(context.session.id).toBe(sessionId);
    expect(context.sessionWorkspaceId).toBe('ws-1');
    expect(context.canWrite).toBe(true);
    expect(context.readOnly).toBe(false);
    expect(context.currentUserRole).toBe('editor');
    expect(context.assistantRow.id).toBe(assistantMessageId);
    expect(context.messages.map((message) => message.id)).toEqual([
      'msg-user-1',
      'msg-assistant-1',
      'msg-user-2',
      assistantMessageId,
    ]);
    expect(context.conversation.map((entry) => entry.role)).toEqual([
      'user',
      'assistant',
      'user',
    ]);
    expect(context.lastUserMessage).toBe('second question');
  });

  it('rejects when session is not found for user', async () => {
    await expect(
      fixture.runtime.prepareAssistantRun({
        userId: 'other-user',
        sessionId,
        assistantMessageId,
      }),
    ).rejects.toThrow('Session not found');
  });

  it('rejects when assistant message id is missing from conversation', async () => {
    await fixture.messageStore.insertMany([
      {
        id: 'msg-user-1',
        sessionId,
        role: 'user',
        content: 'q',
        sequence: 1,
        createdAt: new Date(),
      },
    ]);
    await expect(
      fixture.runtime.prepareAssistantRun({
        userId,
        sessionId,
        assistantMessageId: 'not-there',
      }),
    ).rejects.toThrow('Assistant message not found');
  });

  it('rejects when workspace cannot be resolved', async () => {
    const fixtureNoWorkspace = buildFixture({
      resolveSessionWorkspaceId: async () => null,
    });
    fixtureNoWorkspace.sessionStore.seed({
      id: sessionId,
      userId,
      workspaceId: null,
      primaryContextType: null,
      primaryContextId: null,
      title: 'Test',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    fixtureNoWorkspace.messageStore.seedSession(sessionId, userId);
    await seedConversation(fixtureNoWorkspace);
    await expect(
      fixtureNoWorkspace.runtime.prepareAssistantRun({
        userId,
        sessionId,
        assistantMessageId,
      }),
    ).rejects.toThrow('Workspace not found for user');
  });

  it('passes readOnly/canWrite flags from resolveWorkspaceAccess callback', async () => {
    const resolveWorkspaceAccess = vi.fn(async () => ({
      readOnly: true,
      canWrite: false,
      currentUserRole: 'viewer',
    }));
    const fixtureReadOnly = buildFixture({ resolveWorkspaceAccess });
    fixtureReadOnly.sessionStore.seed({
      id: sessionId,
      userId,
      workspaceId: 'ws-1',
      primaryContextType: null,
      primaryContextId: null,
      title: 'Test',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    fixtureReadOnly.messageStore.seedSession(sessionId, userId);
    await seedConversation(fixtureReadOnly);

    const context = await fixtureReadOnly.runtime.prepareAssistantRun({
      userId,
      sessionId,
      assistantMessageId,
    });
    expect(context.readOnly).toBe(true);
    expect(context.canWrite).toBe(false);
    expect(context.currentUserRole).toBe('viewer');
    expect(resolveWorkspaceAccess).toHaveBeenCalledWith({
      userId,
      workspaceId: 'ws-1',
    });
  });

  it('filters and deduplicates contexts via isChatContextType callback', async () => {
    await seedConversation(fixture);
    const context = await fixture.runtime.prepareAssistantRun({
      userId,
      sessionId,
      assistantMessageId,
      contexts: [
        { contextType: 'organization', contextId: 'org-1' },
        { contextType: 'organization', contextId: 'org-1' }, // duplicate
        { contextType: 'project', contextId: 'proj-1' },
        { contextType: 'unknown-type', contextId: 'ignored' }, // filtered
        { contextType: 'project', contextId: '' }, // filtered (empty id)
      ],
    });
    expect(context.contextsOverride).toEqual([
      { contextType: 'organization', contextId: 'org-1' },
      { contextType: 'project', contextId: 'proj-1' },
    ]);
    expect(context.focusContext).toEqual({
      contextType: 'organization',
      contextId: 'org-1',
    });
  });
});
