/**
 * BR14b Lot 21c — `ChatRuntime.consumeToolCalls` unit tests.
 *
 * Exercises the minimal orchestration shell migrated for Lot 21c:
 *   - Empty-toolCalls short-circuit (sets `continueGenerationLoop =
 *     false`, returns `shouldBreakLoop: true`).
 *   - For-loop with `signal?.aborted` check (throws `AbortError`).
 *   - Local-tool short-circuit (push into `pendingLocalToolCalls` +
 *     emit one `tool_call_result {status:'awaiting_external_result'}`
 *     event via `deps.streamSequencer.allocate` +
 *     `deps.streamBuffer.append`; advances `loopState.streamSeq`).
 *
 * The full per-tool dispatch body (server-tool callback invocation +
 * accumulators + context budget gate + post-loop trace + status
 * events) is deferred to Lot 21d. Tests targeting those paths land
 * alongside the Lot 21d migration.
 *
 * Tests use `InMemoryStreamBuffer` + `InMemoryStreamSequencer`
 * reference adapters to exercise the boundary contract end-to-end.
 */
import { describe, expect, it } from 'vitest';

import { ChatRuntime } from '../src/runtime.js';
import type {
  AssistantRunLoopState,
  ChatRuntimeDeps,
  ConsumeToolCallsInput,
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
  return {
    runtime: new ChatRuntime(deps),
    streamBuffer,
    streamSequencer,
  };
};

const buildLoopState = (
  overrides: Partial<AssistantRunLoopState> = {},
): AssistantRunLoopState => ({
  streamSeq: 1,
  lastObservedStreamSequence: 0,
  contentParts: [],
  reasoningParts: [],
  lastErrorMessage: null,
  executedTools: [],
  toolCalls: [],
  currentMessages: [{ role: 'system', content: 'You are helpful.' }],
  maxIterations: 10,
  todoAutonomousExtensionEnabled: false,
  todoContinuationActive: false,
  todoAwaitingUserInput: false,
  iteration: 0,
  previousResponseId: null,
  pendingResponsesRawInput: null,
  steerHistoryMessages: [],
  steerReasoningReplay: '',
  lastBudgetAnnouncedPct: -1,
  contextBudgetReplanAttempts: 0,
  continueGenerationLoop: true,
  useCodexTransport: false,
  ...overrides,
});

const buildInput = (
  loopState: AssistantRunLoopState,
  overrides: Partial<ConsumeToolCallsInput> = {},
  streamId = 'msg-tool-1',
): ConsumeToolCallsInput => ({
  streamId,
  loopState,
  localToolNames: new Set<string>(['local_run_command', 'local_open_file']),
  sessionId: 'sess-1',
  userId: 'user-1',
  workspaceId: 'ws-1',
  providerId: 'openai',
  modelId: 'gpt-test',
  tools: null,
  enforceTodoUpdateMode: false,
  readOnly: false,
  ...overrides,
});

describe('ChatRuntime.consumeToolCalls (Lot 21c)', () => {
  it('short-circuits on empty toolCalls and flips continueGenerationLoop=false', async () => {
    const { runtime } = buildFixture();
    const loopState = buildLoopState();
    const result = await runtime.consumeToolCalls(buildInput(loopState));
    expect(result.shouldBreakLoop).toBe(true);
    expect(result.toolResults).toEqual([]);
    expect(result.responseToolOutputs).toEqual([]);
    expect(result.pendingLocalToolCalls).toEqual([]);
    expect(result.executedTools).toEqual([]);
    expect(loopState.continueGenerationLoop).toBe(false);
  });

  it('throws AbortError when signal.aborted is true before the first iteration', async () => {
    const { runtime } = buildFixture();
    const loopState = buildLoopState({
      toolCalls: [{ id: 'tc-1', name: 'local_run_command', args: '{}' }],
    });
    const controller = new AbortController();
    controller.abort();
    await expect(
      runtime.consumeToolCalls(buildInput(loopState, { signal: controller.signal })),
    ).rejects.toThrow('AbortError');
  });

  it('pushes a local tool call into pendingLocalToolCalls with parsed args', async () => {
    const { runtime } = buildFixture();
    const loopState = buildLoopState({
      toolCalls: [
        {
          id: 'tc-1',
          name: 'local_run_command',
          args: '{"command":"ls"}',
        },
      ],
    });
    const result = await runtime.consumeToolCalls(buildInput(loopState));
    expect(result.shouldBreakLoop).toBe(false);
    expect(result.pendingLocalToolCalls).toEqual([
      { id: 'tc-1', name: 'local_run_command', args: { command: 'ls' } },
    ]);
  });

  it('emits one awaiting_external_result event per local tool and advances streamSeq', async () => {
    const { runtime, streamBuffer, streamSequencer } = buildFixture();
    const loopState = buildLoopState({
      streamSeq: 5,
      toolCalls: [
        { id: 'tc-1', name: 'local_run_command', args: '{}' },
        { id: 'tc-2', name: 'local_open_file', args: '{"path":"/tmp/x"}' },
      ],
    });
    // Pre-allocate up to seq 4 so the next allocate returns 5.
    for (let i = 0; i < 4; i++) {
      await streamSequencer.allocate('msg-tool-1');
    }
    await runtime.consumeToolCalls(buildInput(loopState));
    const events = await streamBuffer.read('msg-tool-1', { sinceSequence: 0 });
    const toolCallResults = events.filter(
      (e) => e.eventType === 'tool_call_result',
    );
    expect(toolCallResults).toHaveLength(2);
    expect(toolCallResults[0]?.data).toEqual({
      tool_call_id: 'tc-1',
      result: { status: 'awaiting_external_result' },
    });
    expect(toolCallResults[1]?.data).toEqual({
      tool_call_id: 'tc-2',
      result: { status: 'awaiting_external_result' },
    });
    // Sequences are monotonic and the loopState.streamSeq cursor is
    // advanced to (last allocated) + 1.
    expect(toolCallResults[0]?.sequence).toBeLessThan(
      toolCallResults[1]?.sequence ?? -1,
    );
    expect(loopState.streamSeq).toBe(
      (toolCallResults[1]?.sequence ?? 0) + 1,
    );
  });

  it('parses empty args as {} for local tools (verbatim parseToolCallArgs behavior)', async () => {
    const { runtime } = buildFixture();
    const loopState = buildLoopState({
      toolCalls: [{ id: 'tc-1', name: 'local_run_command', args: '' }],
    });
    const result = await runtime.consumeToolCalls(buildInput(loopState));
    expect(result.pendingLocalToolCalls).toEqual([
      { id: 'tc-1', name: 'local_run_command', args: {} },
    ]);
  });

  it('parses malformed args as {} for local tools (verbatim parseToolCallArgs behavior)', async () => {
    const { runtime } = buildFixture();
    const loopState = buildLoopState({
      toolCalls: [
        { id: 'tc-1', name: 'local_run_command', args: 'not-json' },
      ],
    });
    const result = await runtime.consumeToolCalls(buildInput(loopState));
    expect(result.pendingLocalToolCalls).toEqual([
      { id: 'tc-1', name: 'local_run_command', args: {} },
    ]);
  });

  it('does not short-circuit when tool name is unknown (non-local, awaiting Lot 21d dispatch)', async () => {
    const { runtime, streamBuffer } = buildFixture();
    const loopState = buildLoopState({
      toolCalls: [{ id: 'tc-1', name: 'read_initiative', args: '{}' }],
    });
    const result = await runtime.consumeToolCalls(buildInput(loopState));
    // Lot 21c shell — non-local branch is a no-op; no events emitted,
    // no accumulators populated. Lot 21d will wire the dispatch.
    expect(result.shouldBreakLoop).toBe(false);
    expect(result.pendingLocalToolCalls).toEqual([]);
    expect(result.toolResults).toEqual([]);
    expect(result.responseToolOutputs).toEqual([]);
    const events = await streamBuffer.read('msg-tool-1', { sinceSequence: 0 });
    expect(events).toHaveLength(0);
  });

  it('mixes local + non-local tool calls: local short-circuits, non-local is skipped (Lot 21d will dispatch)', async () => {
    const { runtime, streamBuffer } = buildFixture();
    const loopState = buildLoopState({
      toolCalls: [
        { id: 'tc-server', name: 'read_initiative', args: '{}' },
        { id: 'tc-local', name: 'local_run_command', args: '{"x":1}' },
      ],
    });
    await runtime.consumeToolCalls(buildInput(loopState));
    const events = await streamBuffer.read('msg-tool-1', { sinceSequence: 0 });
    const toolCallResults = events.filter(
      (e) => e.eventType === 'tool_call_result',
    );
    // Only the local tool emits an awaiting_external_result event in
    // Lot 21c — the server-tool branch is a no-op until Lot 21d.
    expect(toolCallResults).toHaveLength(1);
    expect(toolCallResults[0]?.data).toEqual({
      tool_call_id: 'tc-local',
      result: { status: 'awaiting_external_result' },
    });
  });

  it('ignores empty tool name (does not match the local-tool branch)', async () => {
    const { runtime } = buildFixture();
    const loopState = buildLoopState({
      toolCalls: [{ id: 'tc-1', name: '', args: '{}' }],
    });
    const result = await runtime.consumeToolCalls(buildInput(loopState));
    expect(result.pendingLocalToolCalls).toEqual([]);
  });

  it('uses streamId from input (not assistantMessageId) for allocation + append', async () => {
    const { runtime, streamBuffer } = buildFixture();
    const loopState = buildLoopState({
      toolCalls: [{ id: 'tc-1', name: 'local_run_command', args: '{}' }],
    });
    await runtime.consumeToolCalls(
      buildInput(loopState, {}, 'msg-custom-stream'),
    );
    const eventsCustom = await streamBuffer.read('msg-custom-stream', {
      fromSequence: 0,
    });
    expect(eventsCustom).toHaveLength(1);
    const eventsDefault = await streamBuffer.read('msg-tool-1', {
      fromSequence: 0,
    });
    expect(eventsDefault).toHaveLength(0);
  });

  it('preserves toolCall.id verbatim across pendingLocalToolCalls + the emitted event payload', async () => {
    const { runtime, streamBuffer } = buildFixture();
    const loopState = buildLoopState({
      toolCalls: [
        {
          id: 'call_abc123-XYZ',
          name: 'local_open_file',
          args: '{"path":"a"}',
        },
      ],
    });
    const result = await runtime.consumeToolCalls(buildInput(loopState));
    expect(result.pendingLocalToolCalls[0]?.id).toBe('call_abc123-XYZ');
    const events = await streamBuffer.read('msg-tool-1', { sinceSequence: 0 });
    expect((events[0]?.data as Record<string, unknown>).tool_call_id).toBe(
      'call_abc123-XYZ',
    );
  });
});
