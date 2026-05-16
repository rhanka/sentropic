/**
 * BR14b Lot 21c / 21e-2 — `ChatRuntime.consumeToolCalls` unit tests.
 *
 * Lot 21c exercised the minimal orchestration shell:
 *   - Empty-toolCalls short-circuit (sets `continueGenerationLoop =
 *     false`, returns `shouldBreakLoop: true`).
 *   - For-loop with `signal?.aborted` check (throws `AbortError`).
 *   - Local-tool short-circuit (push into `pendingLocalToolCalls` +
 *     emit one `tool_call_result {status:'awaiting_external_result'}`
 *     event via `deps.streamSequencer.allocate` +
 *     `deps.streamBuffer.append`; advances `loopState.streamSeq`).
 *
 * Lot 21e-2 extends the method to own the full per-tool dispatch loop
 * body. The new tests below cover the migrated paths:
 *   - Pre-tool context-budget gate (pre-compute + `pre_tool` status +
 *     `applyContextBudgetGate` invocation + deferred-accumulator push).
 *   - Per-tool `executeServerTool` dispatch via the chat-core facade
 *     (Lot 21d-3) — `result` + advanced `streamSeq` returned.
 *   - Success accumulator pushes (`toolResults` / `responseToolOutputs` /
 *     `executedTools`).
 *   - Catch-block error wrapping into `{status:'error',error}` +
 *     `todoErrorCall` marker invocation when `name === 'plan'` AND
 *     `todoAutonomousExtensionEnabled` is true.
 *   - Mixed iterations (local + server tools sequentially).
 *
 * Tests use `InMemoryStreamBuffer` + `InMemoryStreamSequencer`
 * reference adapters to exercise the boundary contract end-to-end. The
 * `executeServerTool` callback is stubbed with the api-side shape
 * (`{ result, streamSeq }`) — the chat-core boundary lies about the
 * type (declared as `ExecuteServerToolResult`) per the Lot 21d-3
 * boundary-opacity decision.
 */
import { describe, expect, it, vi } from 'vitest';

import { ChatRuntime } from '../src/runtime.js';
import type {
  AssistantRunLoopState,
  ChatRuntimeDeps,
  ConsumeToolCallsInput,
  ExecuteServerToolInput,
  ExecuteServerToolResult,
} from '../src/runtime.js';
import type {
  ContextBudgetSnapshot,
  ContextBudgetZone,
} from '../src/context-budget.js';
import type { ChatState } from '../src/types.js';
import {
  InMemoryCheckpointStore,
  InMemoryMessageStore,
  InMemoryMeshDispatch,
  InMemorySessionStore,
  InMemoryStreamBuffer,
  InMemoryStreamSequencer,
} from '../src/in-memory/index.js';

// Mirrors the api-side `resolveBudgetZone` with thresholds 80% / 95%
// (matches `CONTEXT_BUDGET_SOFT_THRESHOLD` / `CONTEXT_BUDGET_HARD_THRESHOLD`
// at chat-service.ts pre-Lot 21e-2).
const TEST_SOFT_THRESHOLD = 80;
const TEST_HARD_THRESHOLD = 95;
const testResolveBudgetZone = (occupancyPct: number): ContextBudgetZone => {
  if (occupancyPct >= TEST_HARD_THRESHOLD) return 'hard';
  if (occupancyPct >= TEST_SOFT_THRESHOLD) return 'soft';
  return 'normal';
};
const testEstimateTokenCountFromChars = (charCount: number): number =>
  Math.max(1, Math.ceil(charCount / 4));

const buildSnapshot = (
  occupancyPct: number,
  maxTokens = 100_000,
): ContextBudgetSnapshot => ({
  estimatedTokens: Math.round((occupancyPct / 100) * maxTokens),
  maxTokens,
  occupancyPct,
  zone: testResolveBudgetZone(occupancyPct),
});

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
    deps,
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

/**
 * Default stub for `buildExecuteServerToolInput`: forwards the per-call
 * ctx into a minimal `ExecuteServerToolInput` shape. The runtime
 * passes this bundle verbatim to `deps.executeServerTool`.
 */
const buildDefaultExecuteServerToolInput = (
  ctx: Parameters<ConsumeToolCallsInput['buildExecuteServerToolInput']>[0],
): ExecuteServerToolInput => ({
  userId: 'user-1',
  sessionId: 'sess-1',
  assistantMessageId: 'msg-assistant-1',
  workspaceId: 'ws-1',
  toolCall: {
    id: ctx.toolCall.id,
    name: ctx.toolCall.name,
    args: ctx.toolCall.args,
  },
  streamSeq: ctx.streamSeq,
  currentMessages: ctx.currentMessages,
  tools: null,
  responseToolOutputs: ctx.responseToolOutputs,
  providerId: 'openai',
  modelId: 'gpt-test',
  enforceTodoUpdateMode: false,
  todoAutonomousExtensionEnabled: false,
  contextBudgetReplanAttempts: 0,
  readOnly: false,
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
  // Lot 21e-2 — gate-related fields
  contextBudgetReplanAttempts: 0,
  maxReplanAttempts: 1,
  softZoneCode: 'context_budget_risk',
  hardZoneCode: 'context_budget_blocked',
  estimateContextBudget: () => buildSnapshot(40),
  estimateToolResultProjectionChars: () => 1_000,
  writeContextBudgetStatus: async () => undefined,
  resolveBudgetZone: testResolveBudgetZone,
  estimateTokenCountFromChars: testEstimateTokenCountFromChars,
  compactContextIfNeeded: async (_reason, snapshot) => snapshot,
  // Lot 21e-2 — catch-block fields
  markTodoIterationState: () => undefined,
  todoAutonomousExtensionEnabled: false,
  // Lot 21e-2 — executeServerTool bundle builder
  buildExecuteServerToolInput: buildDefaultExecuteServerToolInput,
  // Lot 21e-2 — outer state snapshot
  currentMessages: [{ role: 'system', content: 'You are helpful.' }],
  ...overrides,
});

describe('ChatRuntime.consumeToolCalls (Lot 21c / 21e-2)', () => {
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

  it('ignores empty tool name (does not match the local-tool branch)', async () => {
    const { runtime } = buildFixture();
    const loopState = buildLoopState({
      toolCalls: [{ id: 'tc-1', name: '', args: '{}' }],
    });
    // empty name → falls into the try block; executeServerTool stub
    // returns a generic success so the iteration completes without
    // populating pendingLocalToolCalls.
    const execStub = vi.fn(
      async () =>
        ({ result: { ok: true }, streamSeq: 10 } as unknown as ExecuteServerToolResult),
    );
    const { runtime: runtimeWithStub } = buildFixture({
      executeServerTool: execStub,
    });
    const result = await runtimeWithStub.consumeToolCalls(buildInput(loopState));
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

  // ----------------------------------------------------------------
  // Lot 21e-2 — full per-tool dispatch loop body
  // ----------------------------------------------------------------

  it('dispatches a single non-local tool via executeServerTool and pushes success accumulators', async () => {
    const execStub = vi.fn(
      async () =>
        ({ result: { ok: true, payload: 42 }, streamSeq: 11 } as unknown as ExecuteServerToolResult),
    );
    const { runtime } = buildFixture({ executeServerTool: execStub });
    const loopState = buildLoopState({
      streamSeq: 10,
      toolCalls: [{ id: 'tc-server-1', name: 'read_initiative', args: '{"id":"abc"}' }],
    });
    const result = await runtime.consumeToolCalls(buildInput(loopState));
    expect(result.shouldBreakLoop).toBe(false);
    expect(result.toolResults).toEqual([
      {
        role: 'tool',
        content: JSON.stringify({ ok: true, payload: 42 }),
        tool_call_id: 'tc-server-1',
      },
    ]);
    expect(result.responseToolOutputs).toEqual([
      {
        type: 'function_call_output',
        call_id: 'tc-server-1',
        output: JSON.stringify({ ok: true, payload: 42 }),
      },
    ]);
    expect(result.executedTools).toEqual([
      {
        toolCallId: 'tc-server-1',
        name: 'read_initiative',
        args: { id: 'abc' },
        result: { ok: true, payload: 42 },
      },
    ]);
    expect(result.streamSeq).toBe(11);
    expect(loopState.streamSeq).toBe(11);
    expect(execStub).toHaveBeenCalledTimes(1);
  });

  it('catches executeServerTool rejection and pushes the error envelope into accumulators', async () => {
    const execStub = vi.fn(async () => {
      throw new Error('tool dispatch failed');
    });
    const { runtime, streamBuffer } = buildFixture({ executeServerTool: execStub });
    const loopState = buildLoopState({
      streamSeq: 7,
      toolCalls: [{ id: 'tc-fail', name: 'read_initiative', args: '{}' }],
    });
    const result = await runtime.consumeToolCalls(buildInput(loopState));
    const errorEnvelope = { status: 'error', error: 'tool dispatch failed' };
    expect(result.toolResults).toEqual([
      {
        role: 'tool',
        content: JSON.stringify(errorEnvelope),
        tool_call_id: 'tc-fail',
      },
    ]);
    expect(result.responseToolOutputs).toEqual([
      {
        type: 'function_call_output',
        call_id: 'tc-fail',
        output: JSON.stringify(errorEnvelope),
      },
    ]);
    expect(result.executedTools).toEqual([
      {
        toolCallId: 'tc-fail',
        name: 'read_initiative',
        args: {},
        result: errorEnvelope,
      },
    ]);
    const events = await streamBuffer.read('msg-tool-1', { sinceSequence: 0 });
    const toolCallResults = events.filter(
      (e) => e.eventType === 'tool_call_result',
    );
    expect(toolCallResults).toHaveLength(1);
    expect(toolCallResults[0]?.data).toEqual({
      tool_call_id: 'tc-fail',
      result: errorEnvelope,
    });
  });

  it('invokes markTodoIterationState when plan-tool fails AND todoAutonomousExtensionEnabled is true', async () => {
    const execStub = vi.fn(async () => {
      throw new Error('plan failed');
    });
    const markSpy = vi.fn();
    const { runtime } = buildFixture({ executeServerTool: execStub });
    const loopState = buildLoopState({
      toolCalls: [{ id: 'tc-plan-err', name: 'plan', args: '{"action":"create"}' }],
    });
    await runtime.consumeToolCalls(
      buildInput(loopState, {
        todoAutonomousExtensionEnabled: true,
        markTodoIterationState: markSpy,
      }),
    );
    expect(markSpy).toHaveBeenCalledTimes(1);
    expect(markSpy).toHaveBeenCalledWith({ status: 'error', error: 'plan failed' });
  });

  it('skips markTodoIterationState on plan failure when todoAutonomousExtensionEnabled is false', async () => {
    const execStub = vi.fn(async () => {
      throw new Error('plan failed');
    });
    const markSpy = vi.fn();
    const { runtime } = buildFixture({ executeServerTool: execStub });
    const loopState = buildLoopState({
      toolCalls: [{ id: 'tc-plan-err', name: 'plan', args: '{"action":"create"}' }],
    });
    await runtime.consumeToolCalls(
      buildInput(loopState, {
        todoAutonomousExtensionEnabled: false,
        markTodoIterationState: markSpy,
      }),
    );
    expect(markSpy).not.toHaveBeenCalled();
  });

  it('skips markTodoIterationState on non-plan tool failure (todoErrorCall stays false)', async () => {
    const execStub = vi.fn(async () => {
      throw new Error('something broke');
    });
    const markSpy = vi.fn();
    const { runtime } = buildFixture({ executeServerTool: execStub });
    const loopState = buildLoopState({
      toolCalls: [{ id: 'tc-other', name: 'web_search', args: '{}' }],
    });
    await runtime.consumeToolCalls(
      buildInput(loopState, {
        todoAutonomousExtensionEnabled: true,
        markTodoIterationState: markSpy,
      }),
    );
    expect(markSpy).not.toHaveBeenCalled();
  });

  it('dispatches multiple non-local tools sequentially, preserving order and accumulator alignment', async () => {
    const stubResults = [
      { result: { idx: 1 }, streamSeq: 11 },
      { result: { idx: 2 }, streamSeq: 12 },
      { result: { idx: 3 }, streamSeq: 13 },
    ];
    let i = 0;
    const execStub = vi.fn(async () => {
      return stubResults[i++] as unknown as ExecuteServerToolResult;
    });
    const { runtime } = buildFixture({ executeServerTool: execStub });
    const loopState = buildLoopState({
      streamSeq: 10,
      toolCalls: [
        { id: 'tc-1', name: 'read_initiative', args: '{}' },
        { id: 'tc-2', name: 'web_search', args: '{}' },
        { id: 'tc-3', name: 'read_initiative', args: '{}' },
      ],
    });
    const result = await runtime.consumeToolCalls(buildInput(loopState));
    expect(execStub).toHaveBeenCalledTimes(3);
    expect(result.toolResults.map((r) => r.tool_call_id)).toEqual([
      'tc-1',
      'tc-2',
      'tc-3',
    ]);
    expect(result.executedTools.map((e) => e.result)).toEqual([
      { idx: 1 },
      { idx: 2 },
      { idx: 3 },
    ]);
    expect(result.streamSeq).toBe(13);
  });

  it('throws plan-action validation error when toolCall.name === plan and args.action is missing', async () => {
    const execStub = vi.fn(async () => {
      throw new Error('should not be called');
    });
    const { runtime } = buildFixture({ executeServerTool: execStub });
    const loopState = buildLoopState({
      toolCalls: [{ id: 'tc-plan-bad', name: 'plan', args: '{"action":"unknown"}' }],
    });
    const result = await runtime.consumeToolCalls(buildInput(loopState));
    // The throw is caught by the try/catch and wrapped into an error envelope.
    expect(result.toolResults[0]?.content).toContain(
      'plan: action must be one of create|update_plan|update_task',
    );
    expect(execStub).not.toHaveBeenCalled();
  });

  it('derives todoOperation from args.taskId / args.todoId when args.action is absent (plan branch)', async () => {
    const seenInputs: ExecuteServerToolInput[] = [];
    const execStub = vi.fn(async (input: ExecuteServerToolInput) => {
      seenInputs.push(input);
      return {
        result: { ok: true },
        streamSeq: 11,
      } as unknown as ExecuteServerToolResult;
    });
    const buildInputSpy = vi.fn(
      (ctx: Parameters<ConsumeToolCallsInput['buildExecuteServerToolInput']>[0]) =>
        ({
          ...buildDefaultExecuteServerToolInput(ctx),
          // Pass the resolved todoOperation back through a side-channel
          // (the chat-core ExecuteServerToolInput doesn't carry it; the
          // adapter carries it inside its cast-bundle). The test asserts
          // the ctx.todoOperation value the builder receives.
          toolCall: { ...ctx.toolCall },
        } as ExecuteServerToolInput),
    );
    const { runtime } = buildFixture({ executeServerTool: execStub });
    const loopState = buildLoopState({
      toolCalls: [
        { id: 'tc-plan-task', name: 'plan', args: '{"taskId":"task-x"}' },
        { id: 'tc-plan-todo', name: 'plan', args: '{"todoId":"todo-y"}' },
        { id: 'tc-plan-create', name: 'plan', args: '{}' },
      ],
    });
    await runtime.consumeToolCalls(
      buildInput(loopState, { buildExecuteServerToolInput: buildInputSpy }),
    );
    expect(buildInputSpy).toHaveBeenCalledTimes(3);
    expect(buildInputSpy.mock.calls[0]?.[0].todoOperation).toBe('update_task');
    expect(buildInputSpy.mock.calls[1]?.[0].todoOperation).toBe('update_plan');
    expect(buildInputSpy.mock.calls[2]?.[0].todoOperation).toBe('create');
  });

  it('emits a pre_tool context-budget status event for every non-local tool dispatch', async () => {
    const writeStatusSpy = vi.fn(async () => undefined);
    const execStub = vi.fn(
      async () =>
        ({ result: { ok: true }, streamSeq: 11 } as unknown as ExecuteServerToolResult),
    );
    const { runtime } = buildFixture({ executeServerTool: execStub });
    const loopState = buildLoopState({
      toolCalls: [
        { id: 'tc-1', name: 'read_initiative', args: '{}' },
        { id: 'tc-2', name: 'web_search', args: '{}' },
      ],
    });
    await runtime.consumeToolCalls(
      buildInput(loopState, { writeContextBudgetStatus: writeStatusSpy }),
    );
    expect(writeStatusSpy).toHaveBeenCalledTimes(2);
    expect(writeStatusSpy.mock.calls[0]?.[0]).toBe('pre_tool');
    expect(writeStatusSpy.mock.calls[0]?.[2]).toEqual({
      tool_name: 'read_initiative',
    });
    expect(writeStatusSpy.mock.calls[1]?.[2]).toEqual({
      tool_name: 'web_search',
    });
  });

  it('pushes deferred-accumulator into accumulators and continues iteration when gate fires (soft zone)', async () => {
    const execStub = vi.fn(
      async () =>
        ({ result: { unreachable: true }, streamSeq: 99 } as unknown as ExecuteServerToolResult),
    );
    const { runtime, streamBuffer } = buildFixture({ executeServerTool: execStub });
    const loopState = buildLoopState({
      streamSeq: 10,
      toolCalls: [
        { id: 'tc-soft', name: 'web_search', args: '{"query":"long"}' },
      ],
    });
    // Pre-budget at 70% + projected chars of 100_000 → projectedTokens
    // pushes the projected zone to 'soft' (above 80%).
    const result = await runtime.consumeToolCalls(
      buildInput(loopState, {
        estimateContextBudget: () => buildSnapshot(70),
        estimateToolResultProjectionChars: () => 80_000,
      }),
    );
    expect(execStub).not.toHaveBeenCalled();
    expect(result.toolResults).toHaveLength(1);
    expect(result.toolResults[0]?.tool_call_id).toBe('tc-soft');
    const parsed = JSON.parse(result.toolResults[0]?.content ?? '{}');
    expect(parsed.status).toBe('deferred');
    expect(parsed.code).toBe('context_budget_risk');
    expect(result.executedTools).toHaveLength(1);
    expect(result.contextBudgetReplanAttempts).toBe(1);
    // Deferred event from the gate was emitted on the streamBuffer.
    const events = await streamBuffer.read('msg-tool-1', { sinceSequence: 0 });
    const toolCallResults = events.filter(
      (e) => e.eventType === 'tool_call_result',
    );
    expect(toolCallResults).toHaveLength(1);
  });

  it('mixes local + server tools: local short-circuits to pendingLocalToolCalls; server dispatches via executeServerTool', async () => {
    const execStub = vi.fn(
      async () =>
        ({ result: { ok: true }, streamSeq: 11 } as unknown as ExecuteServerToolResult),
    );
    const { runtime, streamBuffer } = buildFixture({ executeServerTool: execStub });
    const loopState = buildLoopState({
      streamSeq: 10,
      toolCalls: [
        { id: 'tc-server', name: 'read_initiative', args: '{}' },
        { id: 'tc-local', name: 'local_run_command', args: '{"x":1}' },
      ],
    });
    const result = await runtime.consumeToolCalls(buildInput(loopState));
    expect(execStub).toHaveBeenCalledTimes(1);
    expect(result.toolResults).toHaveLength(1);
    expect(result.toolResults[0]?.tool_call_id).toBe('tc-server');
    expect(result.pendingLocalToolCalls).toEqual([
      { id: 'tc-local', name: 'local_run_command', args: { x: 1 } },
    ]);
    const events = await streamBuffer.read('msg-tool-1', { sinceSequence: 0 });
    const toolCallResults = events.filter(
      (e) => e.eventType === 'tool_call_result',
    );
    // Only the local short-circuit emits an awaiting_external_result
    // event from inside consumeToolCalls (the server-tool branch's
    // events are emitted inside the api-side executeServerTool body).
    expect(toolCallResults).toHaveLength(1);
    expect(toolCallResults[0]?.data).toEqual({
      tool_call_id: 'tc-local',
      result: { status: 'awaiting_external_result' },
    });
  });

  it('aborts mid-loop when signal.aborted flips between iterations (no pending tools dispatched after abort)', async () => {
    const controller = new AbortController();
    const execStub = vi.fn(async () => {
      // Abort the signal after the first dispatch.
      controller.abort();
      return { result: { ok: true }, streamSeq: 11 } as unknown as ExecuteServerToolResult;
    });
    const { runtime } = buildFixture({ executeServerTool: execStub });
    const loopState = buildLoopState({
      streamSeq: 10,
      toolCalls: [
        { id: 'tc-1', name: 'read_initiative', args: '{}' },
        { id: 'tc-2', name: 'read_initiative', args: '{}' },
      ],
    });
    await expect(
      runtime.consumeToolCalls(buildInput(loopState, { signal: controller.signal })),
    ).rejects.toThrow('AbortError');
    expect(execStub).toHaveBeenCalledTimes(1);
  });

  it('returns advanced streamSeq + reset contextBudgetReplanAttempts when gate passes', async () => {
    const execStub = vi.fn(
      async () =>
        ({ result: { ok: true }, streamSeq: 15 } as unknown as ExecuteServerToolResult),
    );
    const { runtime } = buildFixture({ executeServerTool: execStub });
    const loopState = buildLoopState({
      streamSeq: 10,
      toolCalls: [{ id: 'tc-1', name: 'read_initiative', args: '{}' }],
    });
    const result = await runtime.consumeToolCalls(
      buildInput(loopState, { contextBudgetReplanAttempts: 1 }),
    );
    // Gate passed (normal zone) → counter resets to 0.
    expect(result.contextBudgetReplanAttempts).toBe(0);
    // streamSeq advanced by the executeServerTool callback (it returned 15).
    expect(result.streamSeq).toBe(15);
    expect(loopState.streamSeq).toBe(15);
  });
});
