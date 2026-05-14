/**
 * BR14b Lot 15.5 — ChatRuntime checkpoint orchestration unit tests
 * (Lot 11 migrations: createCheckpoint / listCheckpoints /
 * restoreCheckpoint). Exercise the runtime against the in-memory
 * adapter trio (MessageStore + SessionStore + CheckpointStore<ChatState>)
 * so there is no Postgres dependency.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

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

const buildDeps = (): {
  runtime: ChatRuntime;
  messageStore: InMemoryMessageStore;
  sessionStore: InMemorySessionStore;
  streamBuffer: InMemoryStreamBuffer;
  checkpointStore: InMemoryCheckpointStore<ChatState>;
  mesh: InMemoryMeshDispatch;
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
  };
  return {
    runtime: new ChatRuntime(deps),
    messageStore,
    sessionStore,
    streamBuffer,
    checkpointStore,
    mesh,
  };
};

const seedSession = async (
  fixture: ReturnType<typeof buildDeps>,
  sessionId: string,
  userId: string,
) => {
  fixture.sessionStore.seed({
    id: sessionId,
    userId,
    workspaceId: 'ws-1',
    primaryContextType: null,
    primaryContextId: null,
    title: 'Test session',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  });
  fixture.messageStore.seedSession(sessionId, userId);
};

const seedMessages = async (
  fixture: ReturnType<typeof buildDeps>,
  sessionId: string,
  count: number,
) => {
  const rows: Array<{
    id: string;
    sessionId: string;
    role: string;
    content: string;
    sequence: number;
    createdAt: Date;
  }> = [];
  for (let index = 1; index <= count; index += 1) {
    rows.push({
      id: `msg-${index}`,
      sessionId,
      role: index % 2 === 1 ? 'user' : 'assistant',
      content: `content-${index}`,
      sequence: index,
      createdAt: new Date(`2026-01-01T00:00:${String(index).padStart(2, '0')}Z`),
    });
  }
  await fixture.messageStore.insertMany(rows);
};

describe('ChatRuntime checkpoint orchestration (Lot 11)', () => {
  let fixture: ReturnType<typeof buildDeps>;
  const sessionId = 'session-1';
  const userId = 'user-1';

  beforeEach(async () => {
    fixture = buildDeps();
    await seedSession(fixture, sessionId, userId);
  });

  afterEach(() => {
    fixture.messageStore.reset();
    fixture.sessionStore.reset();
    fixture.checkpointStore.reset();
  });

  it('creates, lists, then restores a checkpoint round-trip', async () => {
    await seedMessages(fixture, sessionId, 4);

    const created = await fixture.runtime.createCheckpoint({
      sessionId,
      title: 'After first turn',
      anchorMessageId: 'msg-2',
    });
    expect(created.anchorMessageId).toBe('msg-2');
    expect(created.anchorSequence).toBe(2);
    expect(created.messageCount).toBe(2);
    expect(created.title).toBe('After first turn');

    const list = await fixture.runtime.listCheckpoints({ sessionId });
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(created.id);
    expect(list[0].anchorSequence).toBe(2);

    // Add follow-up messages.
    await fixture.messageStore.insertMany([
      {
        id: 'msg-5',
        sessionId,
        role: 'user',
        content: 'follow-up',
        sequence: 5,
        createdAt: new Date(),
      },
    ]);

    const restored = await fixture.runtime.restoreCheckpoint({
      sessionId,
      checkpointId: created.id,
    });
    expect(restored.restoredToSequence).toBe(2);
    expect(restored.removedMessages).toBe(3); // sequences 3, 4, 5

    const remaining = await fixture.messageStore.listForSession(sessionId);
    expect(remaining.map((row) => row.sequence)).toEqual([1, 2]);
  });

  it('rejects checkpoint creation on an empty session', async () => {
    await expect(
      fixture.runtime.createCheckpoint({ sessionId, title: 'empty' }),
    ).rejects.toThrow('Cannot create checkpoint on an empty session');
  });

  it('defaults to last message when no anchorMessageId is provided', async () => {
    await seedMessages(fixture, sessionId, 3);
    const created = await fixture.runtime.createCheckpoint({ sessionId });
    expect(created.anchorMessageId).toBe('msg-3');
    expect(created.anchorSequence).toBe(3);
    expect(created.title).toBe('Checkpoint #3');
  });

  it('rejects restore with unknown checkpoint id', async () => {
    await expect(
      fixture.runtime.restoreCheckpoint({ sessionId, checkpointId: 'nope' }),
    ).rejects.toThrow('Checkpoint not found');
  });

  it('caps list result with the provided limit', async () => {
    await seedMessages(fixture, sessionId, 4);
    await fixture.runtime.createCheckpoint({ sessionId, anchorMessageId: 'msg-2' });
    await fixture.runtime.createCheckpoint({ sessionId, anchorMessageId: 'msg-3' });
    await fixture.runtime.createCheckpoint({ sessionId, anchorMessageId: 'msg-4' });

    const limited = await fixture.runtime.listCheckpoints({ sessionId, limit: 2 });
    expect(limited).toHaveLength(2);
  });

  it('checkpoint store tag/fork surface not implemented yet', async () => {
    await expect(fixture.checkpointStore.tag('key', 'label')).rejects.toThrow(
      /not implemented yet/,
    );
    await expect(fixture.checkpointStore.fork('src', 'dst')).rejects.toThrow(
      /not implemented yet/,
    );
  });
});
