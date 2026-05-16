/**
 * BR14b Lot 21b — `ChatRuntime.consumeAssistantStream` unit tests.
 *
 * Exercises the mesh stream consumer migrated from
 * `ChatService.runAssistantGeneration` (chat-service.ts lines
 * 3203-3384 pre-Lot 21b). The runtime drives `deps.mesh.invokeStream`,
 * persists each event via `deps.streamBuffer.append` at sequences
 * allocated by `deps.streamSequencer.allocate`, accumulates content /
 * reasoning / tool-call deltas into the supplied `AssistantRunLoopState`,
 * captures `previousResponseId` from `status` events, polls pending
 * steer messages, and surfaces a terminal
 * `ConsumeAssistantStreamDoneReason`.
 *
 * Tests use `InMemoryMeshDispatch` + `InMemoryStreamBuffer` +
 * `InMemoryStreamSequencer` reference adapters to exercise the
 * boundary contract end-to-end.
 */
import { describe, expect, it } from 'vitest';

import { ChatRuntime } from '../src/runtime.js';
import type {
  AssistantRunLoopState,
  ChatRuntimeDeps,
  ConsumeAssistantStreamInput,
  ConsumeAssistantStreamRequest,
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
    mesh,
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

const buildRequest = (
  overrides: Partial<ConsumeAssistantStreamRequest> = {},
): ConsumeAssistantStreamRequest => ({
  providerId: 'openai',
  model: 'gpt-test',
  userId: 'user-1',
  workspaceId: 'ws-1',
  messages: [{ role: 'user', content: 'Hello' }],
  toolChoice: 'auto',
  reasoningSummary: 'detailed',
  ...overrides,
});

const buildInput = (
  loopState: AssistantRunLoopState,
  requestOverrides: Partial<ConsumeAssistantStreamRequest> = {},
  streamId = 'msg-stream-1',
): ConsumeAssistantStreamInput => ({
  streamId,
  loopState,
  request: buildRequest(requestOverrides),
});

describe('ChatRuntime.consumeAssistantStream (Lot 21b)', () => {
  it('accumulates a single content_delta into finalContent and emits doneReason=normal', async () => {
    const fixture = buildFixture();
    fixture.mesh.enqueueStream([
      { type: 'content_delta', data: { delta: 'Hello world' } },
      { type: 'done', data: {} },
    ]);
    const loopState = buildLoopState();
    const result = await fixture.runtime.consumeAssistantStream(
      buildInput(loopState),
    );
    expect(result.doneReason).toBe('normal');
    expect(result.steerInterruptionBatch).toEqual([]);
    expect(loopState.contentParts).toEqual(['Hello world']);
    const events = fixture.streamBuffer.snapshot('msg-stream-1');
    expect(events).toHaveLength(1);
    expect(events[0]?.eventType).toBe('content_delta');
    expect(events[0]?.sequence).toBe(1);
  });

  it('concatenates multiple content_delta events in order', async () => {
    const fixture = buildFixture();
    fixture.mesh.enqueueStream([
      { type: 'content_delta', data: { delta: 'Hello ' } },
      { type: 'content_delta', data: { delta: 'world' } },
      { type: 'content_delta', data: { delta: '!' } },
      { type: 'done', data: {} },
    ]);
    const loopState = buildLoopState();
    const result = await fixture.runtime.consumeAssistantStream(
      buildInput(loopState),
    );
    expect(result.doneReason).toBe('normal');
    expect(loopState.contentParts.join('')).toBe('Hello world!');
    const events = fixture.streamBuffer.snapshot('msg-stream-1');
    expect(events.map((e) => e.sequence)).toEqual([1, 2, 3]);
  });

  it('populates toolCalls from tool_call_start + tool_call_delta with upsert semantics', async () => {
    const fixture = buildFixture();
    fixture.mesh.enqueueStream([
      {
        type: 'tool_call_start',
        data: {
          tool_call_id: 'call_1',
          name: 'searchWeb',
          args: '{"q":',
        },
      },
      {
        type: 'tool_call_delta',
        data: { tool_call_id: 'call_1', delta: '"hello"}' },
      },
      { type: 'done', data: {} },
    ]);
    const loopState = buildLoopState();
    const result = await fixture.runtime.consumeAssistantStream(
      buildInput(loopState),
    );
    expect(result.doneReason).toBe('normal');
    expect(loopState.toolCalls).toEqual([
      { id: 'call_1', name: 'searchWeb', args: '{"q":"hello"}' },
    ]);
  });

  it('captures error event into loopState.lastErrorMessage and surfaces doneReason=error', async () => {
    const fixture = buildFixture();
    fixture.mesh.enqueueStream([
      { type: 'error', data: { message: 'Provider unavailable' } },
      { type: 'done', data: {} },
    ]);
    const loopState = buildLoopState();
    const result = await fixture.runtime.consumeAssistantStream(
      buildInput(loopState),
    );
    expect(result.doneReason).toBe('error');
    expect(result.errorMessage).toBe('Provider unavailable');
    expect(loopState.lastErrorMessage).toBe('Provider unavailable');
    const events = fixture.streamBuffer.snapshot('msg-stream-1');
    expect(events).toHaveLength(1);
    expect(events[0]?.eventType).toBe('error');
  });

  it('captures previousResponseId from a status event with response_id', async () => {
    const fixture = buildFixture();
    fixture.mesh.enqueueStream([
      { type: 'status', data: { state: 'started', response_id: 'rsp_abc' } },
      { type: 'content_delta', data: { delta: 'OK' } },
      { type: 'done', data: {} },
    ]);
    const loopState = buildLoopState();
    const result = await fixture.runtime.consumeAssistantStream(
      buildInput(loopState),
    );
    expect(result.doneReason).toBe('normal');
    expect(loopState.previousResponseId).toBe('rsp_abc');
  });

  it('breaks the inner loop and surfaces steer_interrupted when a steer message is queued', async () => {
    const fixture = buildFixture();
    // Pre-seed the stream buffer with a steer_received status event so the
    // post-event poll finds it and triggers the interrupt path.
    await fixture.streamBuffer.append(
      'msg-stream-1',
      'status',
      {
        state: 'steer_received',
        message: 'Wait, I changed my mind!',
      },
      1,
      'msg-stream-1',
    );
    fixture.mesh.enqueueStream([
      { type: 'content_delta', data: { delta: 'Hello' } },
      { type: 'content_delta', data: { delta: ' there' } },
      { type: 'done', data: {} },
    ]);
    // streamSequencer must skip past the pre-seeded steer event so the
    // consumer allocates sequence 2 (not 1) for its first append.
    await fixture.streamSequencer.allocate('msg-stream-1');
    const loopState = buildLoopState({ lastObservedStreamSequence: 0 });
    const result = await fixture.runtime.consumeAssistantStream(
      buildInput(loopState),
    );
    expect(result.doneReason).toBe('steer_interrupted');
    expect(result.steerInterruptionBatch).toEqual([
      'Wait, I changed my mind!',
    ]);
    expect(loopState.steerHistoryMessages).toEqual([
      'Wait, I changed my mind!',
    ]);
    expect(loopState.previousResponseId).toBe(null);
    expect(loopState.pendingResponsesRawInput).toBe(null);
    // currentMessages now contains the steer batch appended as user message.
    const lastMsg =
      loopState.currentMessages[loopState.currentMessages.length - 1];
    expect(lastMsg?.role).toBe('user');
    expect(lastMsg?.content).toBe('Wait, I changed my mind!');
    // The stream buffer received: run_interrupted_for_steer +
    // run_resumed_with_steer status events bracketing the consumer body.
    const events = fixture.streamBuffer.snapshot('msg-stream-1');
    const states = events
      .map((e) => (e.data as { state?: string }).state ?? null)
      .filter((s): s is string => typeof s === 'string');
    expect(states).toContain('run_interrupted_for_steer');
    expect(states).toContain('run_resumed_with_steer');
  });

  it('handles previous-response-not-found by emitting response_lineage_reset and surfacing retry_without_previous_response', async () => {
    const fixture = buildFixture();
    // Replace the mesh with one that throws the PRNF error on invokeStream.
    class ThrowingMesh extends InMemoryMeshDispatch {
      override invokeStream(): AsyncIterable<never> {
        return (async function* () {
          throw new Error(
            'OpenAI API error: previous response rsp_old not found',
          );
        })();
      }
    }
    const throwingMesh = new ThrowingMesh();
    const fixture2 = buildFixture({ mesh: throwingMesh });
    const loopState = buildLoopState({
      previousResponseId: 'rsp_old',
      pendingResponsesRawInput: [{ type: 'function_call_output' }],
    });
    const result = await fixture2.runtime.consumeAssistantStream(
      buildInput(loopState),
    );
    expect(result.doneReason).toBe('retry_without_previous_response');
    expect(loopState.previousResponseId).toBe(null);
    expect(loopState.pendingResponsesRawInput).toBe(null);
    const events = fixture2.streamBuffer.snapshot('msg-stream-1');
    expect(events).toHaveLength(1);
    expect(events[0]?.eventType).toBe('status');
    expect((events[0]?.data as { state?: string }).state).toBe(
      'response_lineage_reset',
    );
    // Suppress unused-var lint for the unused first fixture.
    void fixture;
  });

  it('re-throws non-PRNF errors verbatim', async () => {
    class ThrowingMesh extends InMemoryMeshDispatch {
      override invokeStream(): AsyncIterable<never> {
        return (async function* () {
          throw new Error('Network failure');
        })();
      }
    }
    const throwingMesh = new ThrowingMesh();
    const fixture = buildFixture({ mesh: throwingMesh });
    const loopState = buildLoopState({ previousResponseId: 'rsp_x' });
    await expect(
      fixture.runtime.consumeAssistantStream(buildInput(loopState)),
    ).rejects.toThrow('Network failure');
  });

  it('accumulates reasoning_delta and maintains steerReasoningReplay under the cap', async () => {
    const fixture = buildFixture();
    fixture.mesh.enqueueStream([
      { type: 'reasoning_delta', data: { delta: 'Think A.' } },
      { type: 'reasoning_delta', data: { delta: ' Then B.' } },
      { type: 'done', data: {} },
    ]);
    const loopState = buildLoopState();
    const result = await fixture.runtime.consumeAssistantStream(
      buildInput(loopState),
    );
    expect(result.doneReason).toBe('normal');
    expect(loopState.reasoningParts.join('')).toBe('Think A. Then B.');
    expect(loopState.steerReasoningReplay).toBe('Think A. Then B.');
  });

  it('clamps steerReasoningReplay to STEER_REASONING_REPLAY_MAX_CHARS (6000)', async () => {
    const fixture = buildFixture();
    const big = 'X'.repeat(7000);
    fixture.mesh.enqueueStream([
      { type: 'reasoning_delta', data: { delta: big } },
      { type: 'reasoning_delta', data: { delta: 'YZ' } },
      { type: 'done', data: {} },
    ]);
    const loopState = buildLoopState();
    await fixture.runtime.consumeAssistantStream(buildInput(loopState));
    expect(loopState.steerReasoningReplay.length).toBe(6000);
    expect(loopState.steerReasoningReplay.endsWith('XYZ')).toBe(true);
  });

  it('allocates monotonic sequences across all stream writes (sequencer source of truth)', async () => {
    const fixture = buildFixture();
    fixture.mesh.enqueueStream([
      { type: 'status', data: { state: 'started' } },
      { type: 'content_delta', data: { delta: 'a' } },
      { type: 'content_delta', data: { delta: 'b' } },
      { type: 'reasoning_delta', data: { delta: 'reason' } },
      { type: 'done', data: {} },
    ]);
    const loopState = buildLoopState();
    await fixture.runtime.consumeAssistantStream(buildInput(loopState));
    const events = fixture.streamBuffer.snapshot('msg-stream-1');
    expect(events.map((e) => e.sequence)).toEqual([1, 2, 3, 4]);
    expect(await fixture.streamSequencer.peek('msg-stream-1')).toBe(4);
  });
});
