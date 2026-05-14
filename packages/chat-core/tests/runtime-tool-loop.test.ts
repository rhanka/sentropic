/**
 * BR14b Lot 15.5 — tool-loop unit tests.
 * Lot 9: finalizeAssistantMessageFromStream.
 * Lot 10: acceptLocalToolResult + extractAwaitingLocalToolState.
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
  InMemoryStreamSequencer,
} from '../src/in-memory/index.js';

const sessionId = 'session-1';
const userId = 'user-1';
const assistantMessageId = 'msg-assistant';

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
    title: 'Test session',
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  messageStore.seedSession(sessionId, userId);
  return {
    runtime: new ChatRuntime(deps),
    messageStore,
    sessionStore,
    streamBuffer,
  };
};

describe('ChatRuntime.finalizeAssistantMessageFromStream (Lot 9)', () => {
  let fixture: ReturnType<typeof buildFixture>;
  beforeEach(() => {
    fixture = buildFixture();
  });
  afterEach(() => {
    fixture.messageStore.reset();
    fixture.sessionStore.reset();
    fixture.streamBuffer.reset();
  });

  it('aggregates content + reasoning deltas and writes a done event', async () => {
    await fixture.messageStore.insertMany([
      {
        id: assistantMessageId,
        sessionId,
        role: 'assistant',
        content: null,
        sequence: 2,
        createdAt: new Date(),
      },
    ]);
    await fixture.streamBuffer.append(
      assistantMessageId,
      'content_delta',
      { delta: 'Hello ' },
      1,
      assistantMessageId,
    );
    await fixture.streamBuffer.append(
      assistantMessageId,
      'content_delta',
      { delta: 'world' },
      2,
      assistantMessageId,
    );
    await fixture.streamBuffer.append(
      assistantMessageId,
      'reasoning_delta',
      { delta: 'thought' },
      3,
      assistantMessageId,
    );

    const result = await fixture.runtime.finalizeAssistantMessageFromStream({
      assistantMessageId,
    });
    expect(result).toEqual({
      content: 'Hello world',
      reasoning: 'thought',
      wroteDone: true,
    });

    const persisted = await fixture.messageStore.findById(assistantMessageId);
    expect(persisted?.content).toBe('Hello world');
    expect(persisted?.reasoning).toBe('thought');

    const events = fixture.streamBuffer.snapshot(assistantMessageId);
    expect(events.some((event) => event.eventType === 'done')).toBe(true);
  });

  it('skips when message does not exist', async () => {
    const result = await fixture.runtime.finalizeAssistantMessageFromStream({
      assistantMessageId: 'no-such-id',
    });
    expect(result).toBeNull();
  });

  it('returns null when target message is not an assistant', async () => {
    await fixture.messageStore.insertMany([
      {
        id: 'msg-user',
        sessionId,
        role: 'user',
        content: 'hi',
        sequence: 1,
        createdAt: new Date(),
      },
    ]);
    const result = await fixture.runtime.finalizeAssistantMessageFromStream({
      assistantMessageId: 'msg-user',
    });
    expect(result).toBeNull();
  });

  it('does not write a done event when terminal event already exists', async () => {
    await fixture.messageStore.insertMany([
      {
        id: assistantMessageId,
        sessionId,
        role: 'assistant',
        content: null,
        sequence: 1,
        createdAt: new Date(),
      },
    ]);
    await fixture.streamBuffer.append(
      assistantMessageId,
      'content_delta',
      { delta: 'final' },
      1,
      assistantMessageId,
    );
    await fixture.streamBuffer.append(
      assistantMessageId,
      'done',
      {},
      2,
      assistantMessageId,
    );
    const result = await fixture.runtime.finalizeAssistantMessageFromStream({
      assistantMessageId,
    });
    expect(result?.wroteDone).toBe(false);
  });

  it('falls back to fallbackContent when stream has no content_delta', async () => {
    await fixture.messageStore.insertMany([
      {
        id: assistantMessageId,
        sessionId,
        role: 'assistant',
        content: null,
        sequence: 1,
        createdAt: new Date(),
      },
    ]);
    const result = await fixture.runtime.finalizeAssistantMessageFromStream({
      assistantMessageId,
      fallbackContent: 'cancelled by user',
      reason: 'cancelled',
    });
    expect(result?.content).toBe('cancelled by user');
  });
});

describe('ChatRuntime.acceptLocalToolResult (Lot 10)', () => {
  let fixture: ReturnType<typeof buildFixture>;
  beforeEach(() => {
    fixture = buildFixture();
  });
  afterEach(() => {
    fixture.messageStore.reset();
    fixture.sessionStore.reset();
    fixture.streamBuffer.reset();
  });

  const seedAwaitingState = async (
    pending: Array<{ id: string; name: string; args: unknown }>,
    base: Array<{ callId: string; output: string }> = [],
  ) => {
    await fixture.messageStore.insertMany([
      {
        id: assistantMessageId,
        sessionId,
        role: 'assistant',
        content: null,
        sequence: 2,
        createdAt: new Date(),
      },
    ]);
    await fixture.streamBuffer.append(
      assistantMessageId,
      'status',
      {
        state: 'awaiting_local_tool_results',
        previous_response_id: 'resp_42',
        pending_local_tool_calls: pending.map((entry) => ({
          tool_call_id: entry.id,
          name: entry.name,
          args: entry.args,
        })),
        base_tool_outputs: base.map((entry) => ({
          call_id: entry.callId,
          output: entry.output,
        })),
        local_tool_definitions: [
          {
            name: 'do_thing',
            description: 'does a thing',
            parameters: { type: 'object' },
          },
        ],
      },
      1,
      assistantMessageId,
    );
  };

  it('returns readyToResume when the final pending call is satisfied', async () => {
    await seedAwaitingState([{ id: 'call_1', name: 'do_thing', args: { x: 1 } }]);

    const response = await fixture.runtime.acceptLocalToolResult({
      assistantMessageId,
      toolCallId: 'call_1',
      result: { value: 42 },
    });
    expect(response.readyToResume).toBe(true);
    expect(response.waitingForToolCallIds).toEqual([]);
    expect(response.resumeFrom?.previousResponseId).toBe('resp_42');
    expect(response.resumeFrom?.toolOutputs).toHaveLength(1);
    expect(response.resumeFrom?.toolOutputs[0]?.callId).toBe('call_1');
  });

  it('returns waiting list when other tools remain pending', async () => {
    await seedAwaitingState([
      { id: 'call_1', name: 'do_thing', args: {} },
      { id: 'call_2', name: 'do_thing', args: {} },
    ]);
    const response = await fixture.runtime.acceptLocalToolResult({
      assistantMessageId,
      toolCallId: 'call_1',
      result: { status: 'completed', value: 'ok' },
    });
    expect(response.readyToResume).toBe(false);
    expect(response.waitingForToolCallIds).toEqual(['call_2']);
    expect(response.resumeFrom).toBeUndefined();
  });

  it('rejects empty toolCallId', async () => {
    await seedAwaitingState([{ id: 'call_1', name: 'do_thing', args: {} }]);
    await expect(
      fixture.runtime.acceptLocalToolResult({
        assistantMessageId,
        toolCallId: '',
        result: {},
      }),
    ).rejects.toThrow('toolCallId is required');
  });

  it('rejects when no awaiting state can be found', async () => {
    await fixture.messageStore.insertMany([
      {
        id: assistantMessageId,
        sessionId,
        role: 'assistant',
        content: null,
        sequence: 1,
        createdAt: new Date(),
      },
    ]);
    await expect(
      fixture.runtime.acceptLocalToolResult({
        assistantMessageId,
        toolCallId: 'call_1',
        result: {},
      }),
    ).rejects.toThrow('No pending local tool call found');
  });

  it('rejects when the toolCallId is not in the pending set', async () => {
    await seedAwaitingState([{ id: 'call_1', name: 'do_thing', args: {} }]);
    await expect(
      fixture.runtime.acceptLocalToolResult({
        assistantMessageId,
        toolCallId: 'call_other',
        result: {},
      }),
    ).rejects.toThrow('not pending for this assistant message');
  });

  it('merges base tool outputs from awaiting state when resume is ready', async () => {
    await seedAwaitingState(
      [{ id: 'call_local', name: 'do_thing', args: {} }],
      [{ callId: 'call_base', output: '{"server":"yes"}' }],
    );
    const response = await fixture.runtime.acceptLocalToolResult({
      assistantMessageId,
      toolCallId: 'call_local',
      result: { value: 'local-output' },
    });
    expect(response.readyToResume).toBe(true);
    const callIds = response.resumeFrom?.toolOutputs.map((output) => output.callId) ?? [];
    expect(callIds).toContain('call_base');
    expect(callIds).toContain('call_local');
  });
});
