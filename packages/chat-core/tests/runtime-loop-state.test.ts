/**
 * BR14b Lot 21a — `ChatRuntime.beginAssistantRunLoop` unit tests.
 *
 * Exercises the loop-state initializer migrated from
 * `ChatService.runAssistantGeneration` (chat-service.ts lines
 * 2899-2937 + 3004 pre-Lot 21a). The runtime method performs the
 * initial `streamBuffer.getNextSequence(assistantMessageId)` lookup
 * and returns the 20-field `AssistantRunLoopState` value object
 * initialized verbatim from the inline block.
 *
 * Tests use the `InMemoryStreamBuffer` + `InMemoryStreamSequencer`
 * reference adapters to exercise the boundary contract end-to-end.
 */
import { describe, expect, it } from 'vitest';

import { ChatRuntime } from '../src/runtime.js';
import type {
  ChatRuntimeDeps,
  BeginAssistantRunLoopInput,
} from '../src/runtime.js';
import type { ChatState } from '../src/types.js';
import {
  InMemoryCheckpointStore,
  InMemoryMessageStore,
  InMemoryMeshDispatch,
  InMemorySessionStore,
  InMemoryStreamBuffer,
  InMemoryStreamSequencer,
} from '../src/in-memory/index.js';

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
    resolveSessionWorkspaceId: async () => null,
    listSessionDocuments: async () => [],
    listAssistantDetailsByMessageId: async () => ({}),
    resolveWorkspaceAccess: async () => ({
      readOnly: false,
      canWrite: true,
      currentUserRole: 'editor',
    }),
    ...overrides,
  };
  return { runtime: new ChatRuntime(deps), streamBuffer };
};

const buildInput = (
  overrides: Partial<BeginAssistantRunLoopInput> = {},
): BeginAssistantRunLoopInput => ({
  assistantMessageId: 'msg-loop-1',
  systemPrompt: 'You are a helpful assistant.',
  conversation: [
    { role: 'user', content: 'Hello there.' },
    { role: 'assistant', content: 'Hi! How can I help?' },
    { role: 'user', content: 'Plan a roadmap please.' },
  ],
  enforceTodoUpdateMode: false,
  todoProgressionFocusMode: false,
  hasActiveSessionTodo: false,
  baseMaxIterations: 10,
  ...overrides,
});

describe('ChatRuntime.beginAssistantRunLoop (Lot 21a)', () => {
  it('initializes every field with the verbatim pre-Lot 21a defaults', async () => {
    const { runtime } = buildFixture();
    const state = await runtime.beginAssistantRunLoop(buildInput());
    expect(state.streamSeq).toBe(1);
    expect(state.lastObservedStreamSequence).toBe(0);
    expect(state.contentParts).toEqual([]);
    expect(state.reasoningParts).toEqual([]);
    expect(state.lastErrorMessage).toBeNull();
    expect(state.executedTools).toEqual([]);
    expect(state.toolCalls).toEqual([]);
    expect(state.maxIterations).toBe(10);
    expect(state.todoAutonomousExtensionEnabled).toBe(false);
    expect(state.todoContinuationActive).toBe(false);
    expect(state.todoAwaitingUserInput).toBe(false);
    expect(state.iteration).toBe(0);
    expect(state.previousResponseId).toBeNull();
    expect(state.pendingResponsesRawInput).toBeNull();
    expect(state.steerHistoryMessages).toEqual([]);
    expect(state.steerReasoningReplay).toBe('');
    expect(state.lastBudgetAnnouncedPct).toBe(-1);
    expect(state.contextBudgetReplanAttempts).toBe(0);
    expect(state.continueGenerationLoop).toBe(true);
  });

  it('prepends the system prompt to currentMessages and preserves conversation order', async () => {
    const { runtime } = buildFixture();
    const state = await runtime.beginAssistantRunLoop(
      buildInput({
        systemPrompt: 'SYSTEM-PROMPT',
        conversation: [
          { role: 'user', content: 'A' },
          { role: 'assistant', content: 'B' },
        ],
      }),
    );
    expect(state.currentMessages).toEqual([
      { role: 'system', content: 'SYSTEM-PROMPT' },
      { role: 'user', content: 'A' },
      { role: 'assistant', content: 'B' },
    ]);
  });

  it('drives streamSeq from streamBuffer.getNextSequence and reflects existing events', async () => {
    const { runtime, streamBuffer } = buildFixture();
    await streamBuffer.append('msg-loop-existing', 'status', { state: 'started' }, 1, 'msg-loop-existing');
    await streamBuffer.append('msg-loop-existing', 'content_delta', { delta: 'x' }, 2, 'msg-loop-existing');
    const state = await runtime.beginAssistantRunLoop(
      buildInput({ assistantMessageId: 'msg-loop-existing' }),
    );
    expect(state.streamSeq).toBe(3);
    expect(state.lastObservedStreamSequence).toBe(2);
  });

  it('caps lastObservedStreamSequence at 0 when streamSeq is 1 (no prior events)', async () => {
    const { runtime } = buildFixture();
    const state = await runtime.beginAssistantRunLoop(buildInput());
    expect(state.streamSeq).toBe(1);
    expect(state.lastObservedStreamSequence).toBe(0);
  });

  it('uses baseMaxIterations from the input verbatim', async () => {
    const { runtime } = buildFixture();
    const state = await runtime.beginAssistantRunLoop(
      buildInput({ baseMaxIterations: 25 }),
    );
    expect(state.maxIterations).toBe(25);
  });

  it('enables the todo-autonomous loop when enforceTodoUpdateMode && todoProgressionFocusMode are both true', async () => {
    const { runtime } = buildFixture();
    const state = await runtime.beginAssistantRunLoop(
      buildInput({
        enforceTodoUpdateMode: true,
        todoProgressionFocusMode: true,
        hasActiveSessionTodo: true,
      }),
    );
    expect(state.todoAutonomousExtensionEnabled).toBe(true);
    expect(state.todoContinuationActive).toBe(true);
  });

  it('keeps todoContinuationActive false when hasActiveSessionTodo is false even if extension is enabled', async () => {
    const { runtime } = buildFixture();
    const state = await runtime.beginAssistantRunLoop(
      buildInput({
        enforceTodoUpdateMode: true,
        todoProgressionFocusMode: true,
        hasActiveSessionTodo: false,
      }),
    );
    expect(state.todoAutonomousExtensionEnabled).toBe(true);
    expect(state.todoContinuationActive).toBe(false);
  });

  it('projects resumeFrom into previousResponseId + pendingResponsesRawInput verbatim', async () => {
    const { runtime } = buildFixture();
    const state = await runtime.beginAssistantRunLoop(
      buildInput({
        resumeFrom: {
          previousResponseId: 'resp_abc',
          toolOutputs: [
            { callId: 'call_1', output: '{"ok":true}' },
            { callId: 'call_2', output: 'second', name: 'tool_x', args: { a: 1 } },
          ],
        },
      }),
    );
    expect(state.previousResponseId).toBe('resp_abc');
    expect(state.pendingResponsesRawInput).toEqual([
      { type: 'function_call_output', call_id: 'call_1', output: '{"ok":true}' },
      { type: 'function_call_output', call_id: 'call_2', output: 'second' },
    ]);
  });

  it('leaves resumeFrom-projected fields null when resumeFrom is undefined', async () => {
    const { runtime } = buildFixture();
    const state = await runtime.beginAssistantRunLoop(buildInput());
    expect(state.previousResponseId).toBeNull();
    expect(state.pendingResponsesRawInput).toBeNull();
  });
});
