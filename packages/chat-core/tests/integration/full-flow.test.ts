/**
 * BR14b Lot 23 preview — `@sentropic/chat-core` inter-lib integration tests.
 *
 * Exercises the FULL chat-core composition end-to-end against the 6 reference
 * `InMemory*` adapters mandated by SPEC_STUDY_ARCHITECTURE_BOUNDARIES §5
 * (`MessageStore`, `SessionStore`, `StreamBuffer`, `StreamSequencer`,
 * `CheckpointStore`, `MeshDispatchPort`). Each case wires a single
 * `ChatRuntime` instance with trivial stubs for the Option A callbacks
 * (`buildSystemPrompt`, `evaluateReasoningEffort`, `ensureSessionTitle`,
 * `resolveModelSelection`, `resolveSessionWorkspaceId`,
 * `resolveWorkspaceAccess`, etc.) and drives the public method surface
 * in the same order that `ChatService.runAssistantGeneration` does in
 * `api/src/services/chat-service.ts`:
 *
 *   1. `prepareAssistantRun`          (Lot 15)
 *   2. `ensureSessionTitle`           (Lot 16a)
 *   3. `prepareSystemPrompt`          (Lot 16b)
 *   4. `resolveModelSelection`        (Lot 17)
 *   5. `evaluateReasoningEffort`      (Lot 18/20)
 *   6. `beginAssistantRunLoop`        (Lot 21a)
 *   7. `consumeAssistantStream`       (Lot 21b)
 *   8. `consumeToolCalls`             (Lot 21c shell)
 *   9. `finalizeAssistantMessageFromStream`
 *  10. `createCheckpoint` / `listCheckpoints` / `restoreCheckpoint` (Lot 11)
 *  11. `acceptLocalToolResult`        (Lot 10)
 *
 * Five cases:
 *   - Case 1: happy single-turn chat without tools.
 *   - Case 2: assistant emits a local tool_call_start, runtime emits
 *             `awaiting_external_result`, then `acceptLocalToolResult`
 *             surfaces `readyToResume:true` with merged tool outputs.
 *   - Case 3: cancellation mid-loop via `AbortSignal`.
 *   - Case 4: reasoning-effort evaluator path emits both bracketing
 *             status events into the stream buffer.
 *   - Case 5: checkpoint create + list + restore round-trip via the
 *             composed `CheckpointStore` adapter.
 *
 * NOTE: This file lives in `tests/integration/` rather than next to the
 * existing `runtime-*.test.ts` unit files because every case composes
 * multiple `ChatRuntime` methods + several in-memory adapters; the unit
 * suites exercise each migration slice in isolation.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ChatRuntime } from '../../src/runtime.js';
import type {
  AssistantRunLoopState,
  BuildSystemPromptResult,
  ChatRuntimeDeps,
  ConsumeAssistantStreamRequest,
  EvaluateReasoningEffortInput,
  ReasoningEffortEvaluation,
} from '../../src/runtime.js';
import type { ChatState } from '../../src/types.js';
import {
  InMemoryCheckpointStore,
  InMemoryMessageStore,
  InMemoryMeshDispatch,
  InMemorySessionStore,
  InMemoryStreamBuffer,
  InMemoryStreamSequencer,
} from '../../src/in-memory/index.js';

// -----------------------------------------------------------------------
// Fixtures: 6 in-memory adapters + a builder that wires them through
// `ChatRuntime` together with the minimal callback set required by the
// end-to-end flow.
// -----------------------------------------------------------------------

const ALLOWED_CONTEXT_TYPES = new Set([
  'organization',
  'project',
  'initiative',
  'chat_session',
]);

const buildPromptResult = (
  overrides: Partial<BuildSystemPromptResult> = {},
): BuildSystemPromptResult => ({
  systemPrompt: 'You are a helpful assistant.',
  tools: undefined,
  localTools: [],
  localToolNames: new Set<string>(),
  allowedByType: {
    organization: new Set<string>(),
    folder: new Set<string>(),
    usecase: new Set<string>(),
    executive_summary: new Set<string>(),
  },
  allowedFolderIds: new Set<string>(),
  allowedDocContexts: [],
  allowedCommentContexts: [],
  hasContextType: () => false,
  primaryContextType: null,
  primaryContextId: null,
  vscodeCodeAgentPayload: null,
  enforceTodoUpdateMode: false,
  todoStructuralMutationIntent: false,
  todoProgressionFocusMode: false,
  hasActiveSessionTodo: false,
  ...overrides,
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
    buildSystemPrompt: async () => buildPromptResult(),
    ensureSessionTitle: async () => 'Inferred title',
    ...overrides,
  };
  return {
    runtime: new ChatRuntime(deps),
    deps,
    messageStore,
    sessionStore,
    streamBuffer,
    streamSequencer,
    checkpointStore,
    mesh,
  };
};

const sessionId = 'session-integration-1';
const userId = 'user-integration-1';
const assistantMessageId = 'msg-assistant-1';

const seedSessionAndUserTurn = async (
  fixture: ReturnType<typeof buildFixture>,
  options: { title?: string | null; userText?: string } = {},
) => {
  fixture.sessionStore.seed({
    id: sessionId,
    userId,
    workspaceId: 'ws-1',
    primaryContextType: null,
    primaryContextId: null,
    title: options.title === undefined ? 'Existing title' : options.title,
    createdAt: new Date('2026-05-14T10:00:00Z'),
    updatedAt: new Date('2026-05-14T10:00:00Z'),
  });
  fixture.messageStore.seedSession(sessionId, userId);
  await fixture.messageStore.insertMany([
    {
      id: 'msg-user-1',
      sessionId,
      role: 'user',
      content: options.userText ?? 'Hello, how are you today?',
      sequence: 1,
      createdAt: new Date('2026-05-14T10:00:01Z'),
    },
    {
      id: assistantMessageId,
      sessionId,
      role: 'assistant',
      content: null,
      sequence: 2,
      createdAt: new Date('2026-05-14T10:00:02Z'),
    },
  ]);
};

const buildBaseRequest = (
  loopState: AssistantRunLoopState,
  overrides: Partial<ConsumeAssistantStreamRequest> = {},
): ConsumeAssistantStreamRequest => ({
  providerId: 'openai',
  model: 'gpt-test',
  userId,
  workspaceId: 'ws-1',
  messages: loopState.currentMessages,
  toolChoice: 'auto',
  reasoningSummary: 'detailed',
  ...overrides,
});

describe('ChatRuntime integration — inter-lib full-flow composition', () => {
  let fixture: ReturnType<typeof buildFixture>;

  beforeEach(() => {
    fixture = buildFixture();
  });

  afterEach(() => {
    fixture.messageStore.reset();
    fixture.sessionStore.reset();
    fixture.streamBuffer.reset();
    fixture.streamSequencer.reset();
    fixture.checkpointStore.reset();
    fixture.mesh.reset();
  });

  // ---------------------------------------------------------------------
  // CASE 1 — Happy path single-turn chat without tools.
  // ---------------------------------------------------------------------
  it('runs a happy-path single-turn chat without tools end-to-end', async () => {
    await seedSessionAndUserTurn(fixture, { title: null });

    // 1. Precheck slice (Lot 15)
    const ctx = await fixture.runtime.prepareAssistantRun({
      userId,
      sessionId,
      assistantMessageId,
    });
    expect(ctx.session.id).toBe(sessionId);
    expect(ctx.lastUserMessage).toBe('Hello, how are you today?');

    // 2. Title-gen (Lot 16a)
    const title = await fixture.runtime.ensureSessionTitle({
      session: ctx.session,
      sessionWorkspaceId: ctx.sessionWorkspaceId,
      focusContext: ctx.focusContext,
      lastUserMessage: ctx.lastUserMessage,
    });
    expect(title).toBe('Inferred title');

    // 3. System prompt build (Lot 16b)
    const prompt = await fixture.runtime.prepareSystemPrompt(ctx, {
      userId,
      sessionId,
      requestedTools: [],
    });
    expect(prompt.systemPrompt).toBe('You are a helpful assistant.');

    // 4. Model selection (Lot 12 / 17)
    const selection = await fixture.runtime.resolveModelSelection({ userId });
    expect(selection).toEqual({ provider_id: 'openai', model_id: 'gpt-test' });

    // 5. Loop-state init (Lot 21a) — assistantMessageId drives the stream id.
    const loopState = await fixture.runtime.beginAssistantRunLoop({
      assistantMessageId,
      systemPrompt: prompt.systemPrompt,
      conversation: ctx.conversation,
      enforceTodoUpdateMode: prompt.enforceTodoUpdateMode,
      todoProgressionFocusMode: prompt.todoProgressionFocusMode,
      hasActiveSessionTodo: prompt.hasActiveSessionTodo,
      baseMaxIterations: 10,
    });
    expect(loopState.currentMessages[0]).toEqual({
      role: 'system',
      content: 'You are a helpful assistant.',
    });
    expect(loopState.streamSeq).toBe(1);

    // 6. Mesh stream consumer (Lot 21b) — script a content_delta + done.
    fixture.mesh.enqueueStream([
      { type: 'content_delta', data: { delta: 'I am well, ' } },
      { type: 'content_delta', data: { delta: 'thank you!' } },
      { type: 'done', data: {} },
    ]);
    const streamResult = await fixture.runtime.consumeAssistantStream({
      streamId: assistantMessageId,
      loopState,
      request: buildBaseRequest(loopState),
    });
    expect(streamResult.doneReason).toBe('normal');
    expect(loopState.contentParts.join('')).toBe('I am well, thank you!');

    // 7. Tool-call dispatch (Lot 21c) — no tool calls accumulated; short-circuit.
    const toolResult = await fixture.runtime.consumeToolCalls({
      streamId: assistantMessageId,
      loopState,
      localToolNames: new Set<string>(),
      sessionId,
      userId,
      workspaceId: 'ws-1',
      providerId: selection.provider_id,
      modelId: selection.model_id,
      tools: null,
      enforceTodoUpdateMode: false,
      readOnly: false,
    });
    expect(toolResult.shouldBreakLoop).toBe(true);
    expect(loopState.continueGenerationLoop).toBe(false);

    // 8. Finalize assistant message — persists content + touches session.
    const finalize = await fixture.runtime.finalizeAssistantMessageFromStream({
      assistantMessageId,
    });
    expect(finalize).not.toBeNull();
    expect(finalize?.content).toBe('I am well, thank you!');
    expect(finalize?.wroteDone).toBe(true);

    // 9. Assert end state across all in-memory stores.
    const rows = fixture.messageStore.snapshot();
    const assistantRow = rows.find((row) => row.id === assistantMessageId);
    expect(assistantRow?.content).toBe('I am well, thank you!');
    expect(assistantRow?.reasoning).toBeNull();

    const events = fixture.streamBuffer.snapshot(assistantMessageId);
    const eventTypes = events.map((event) => event.eventType);
    expect(eventTypes).toContain('content_delta');
    expect(eventTypes).toContain('done');
    // sequences strictly monotonic and gap-free
    expect(events.map((event) => event.sequence)).toEqual([1, 2, 3]);

    // sessionStore.updatedAt was touched by finalize.
    const sessionRow = fixture.sessionStore
      .snapshot()
      .find((row) => row.id === sessionId);
    expect(sessionRow?.updatedAt).toBeInstanceOf(Date);
  });

  // ---------------------------------------------------------------------
  // CASE 2 — Local-tool handoff: tool_call_start -> awaiting -> accept.
  // ---------------------------------------------------------------------
  it('drives a local-tool handoff via consumeToolCalls + acceptLocalToolResult', async () => {
    await seedSessionAndUserTurn(fixture, { userText: 'Run the lint check.' });
    const localToolNames = new Set<string>(['local_run_lint']);

    // Precheck + prompt + loop init.
    const ctx = await fixture.runtime.prepareAssistantRun({
      userId,
      sessionId,
      assistantMessageId,
    });
    const prompt = await fixture.runtime.prepareSystemPrompt(ctx, {
      userId,
      sessionId,
      requestedTools: ['local_run_lint'],
    });
    const loopState = await fixture.runtime.beginAssistantRunLoop({
      assistantMessageId,
      systemPrompt: prompt.systemPrompt,
      conversation: ctx.conversation,
      enforceTodoUpdateMode: false,
      todoProgressionFocusMode: false,
      hasActiveSessionTodo: false,
      baseMaxIterations: 10,
    });

    // Mesh emits a tool_call_start for the local tool, then done.
    fixture.mesh.enqueueStream([
      {
        type: 'tool_call_start',
        data: { tool_call_id: 'tc-lint-1', name: 'local_run_lint', args: '{}' },
      },
      {
        type: 'status',
        data: {
          state: 'awaiting_local_tool_results',
          previous_response_id: 'rsp_lint',
          pending_local_tool_calls: [
            { tool_call_id: 'tc-lint-1', name: 'local_run_lint', args: {} },
          ],
          base_tool_outputs: [],
          local_tool_definitions: [
            {
              name: 'local_run_lint',
              description: 'Runs the local lint check.',
              parameters: { type: 'object' },
            },
          ],
        },
      },
      { type: 'done', data: {} },
    ]);
    const streamResult = await fixture.runtime.consumeAssistantStream({
      streamId: assistantMessageId,
      loopState,
      request: buildBaseRequest(loopState),
    });
    expect(streamResult.doneReason).toBe('normal');
    expect(loopState.toolCalls).toEqual([
      { id: 'tc-lint-1', name: 'local_run_lint', args: '{}' },
    ]);

    // consumeToolCalls short-circuits the local tool: emits
    // tool_call_result {status:'awaiting_external_result'} and queues it
    // into pendingLocalToolCalls.
    const toolResult = await fixture.runtime.consumeToolCalls({
      streamId: assistantMessageId,
      loopState,
      localToolNames,
      sessionId,
      userId,
      workspaceId: 'ws-1',
      providerId: 'openai',
      modelId: 'gpt-test',
      tools: null,
      enforceTodoUpdateMode: false,
      readOnly: false,
    });
    expect(toolResult.shouldBreakLoop).toBe(false);
    expect(toolResult.pendingLocalToolCalls).toEqual([
      { id: 'tc-lint-1', name: 'local_run_lint', args: {} },
    ]);

    // Verify the awaiting_external_result event landed in the buffer.
    const eventsAfterDispatch = fixture.streamBuffer.snapshot(assistantMessageId);
    const awaitingResultEvent = eventsAfterDispatch.find(
      (event) =>
        event.eventType === 'tool_call_result' &&
        (event.data as { tool_call_id?: string }).tool_call_id === 'tc-lint-1',
    );
    expect(awaitingResultEvent).toBeDefined();
    expect((awaitingResultEvent?.data as { result: { status: string } }).result.status).toBe(
      'awaiting_external_result',
    );

    // External adapter delivers the local tool result.
    const accept = await fixture.runtime.acceptLocalToolResult({
      assistantMessageId,
      toolCallId: 'tc-lint-1',
      result: { status: 'completed', stdout: 'no lint errors' },
    });
    expect(accept.readyToResume).toBe(true);
    expect(accept.waitingForToolCallIds).toEqual([]);
    expect(accept.resumeFrom?.previousResponseId).toBe('rsp_lint');
    expect(accept.resumeFrom?.toolOutputs).toHaveLength(1);
    expect(accept.resumeFrom?.toolOutputs[0]?.callId).toBe('tc-lint-1');

    // Two new events landed: tool_call_result + status:local_tool_result_received.
    const finalEvents = fixture.streamBuffer.snapshot(assistantMessageId);
    const states = finalEvents
      .map((event) => (event.data as { state?: string }).state ?? null)
      .filter((value): value is string => typeof value === 'string');
    expect(states).toContain('awaiting_local_tool_results');
    expect(states).toContain('local_tool_result_received');
  });

  // ---------------------------------------------------------------------
  // CASE 3 — Cancellation via AbortSignal during tool dispatch.
  // ---------------------------------------------------------------------
  it('cancels mid-loop when AbortSignal is aborted before tool dispatch', async () => {
    await seedSessionAndUserTurn(fixture);
    const ctx = await fixture.runtime.prepareAssistantRun({
      userId,
      sessionId,
      assistantMessageId,
    });
    const prompt = await fixture.runtime.prepareSystemPrompt(ctx, {
      userId,
      sessionId,
      requestedTools: [],
    });
    const loopState = await fixture.runtime.beginAssistantRunLoop({
      assistantMessageId,
      systemPrompt: prompt.systemPrompt,
      conversation: ctx.conversation,
      enforceTodoUpdateMode: false,
      todoProgressionFocusMode: false,
      hasActiveSessionTodo: false,
      baseMaxIterations: 10,
    });

    // Mesh streams a partial response then a tool_call_start, after which
    // the caller aborts.
    fixture.mesh.enqueueStream([
      { type: 'content_delta', data: { delta: 'thinking...' } },
      {
        type: 'tool_call_start',
        data: { tool_call_id: 'tc-x', name: 'remote_lookup', args: '{}' },
      },
      { type: 'done', data: {} },
    ]);
    await fixture.runtime.consumeAssistantStream({
      streamId: assistantMessageId,
      loopState,
      request: buildBaseRequest(loopState),
    });
    expect(loopState.toolCalls).toHaveLength(1);

    const controller = new AbortController();
    controller.abort();
    await expect(
      fixture.runtime.consumeToolCalls({
        streamId: assistantMessageId,
        loopState,
        localToolNames: new Set<string>(),
        sessionId,
        userId,
        workspaceId: 'ws-1',
        providerId: 'openai',
        modelId: 'gpt-test',
        tools: null,
        enforceTodoUpdateMode: false,
        readOnly: false,
        signal: controller.signal,
      }),
    ).rejects.toThrow('AbortError');

    // Finalize after cancellation writes a `done` event with the
    // `cancelled` reason (no terminal in the buffer because tool dispatch
    // never completed). The partial content from consumeAssistantStream is
    // persisted onto the assistant row.
    const finalize = await fixture.runtime.finalizeAssistantMessageFromStream({
      assistantMessageId,
      reason: 'cancelled',
    });
    expect(finalize?.wroteDone).toBe(true);
    expect(finalize?.content).toBe('thinking...');
    const doneEvents = fixture.streamBuffer
      .snapshot(assistantMessageId)
      .filter((event) => event.eventType === 'done');
    expect(doneEvents).toHaveLength(1);
    expect((doneEvents[0]?.data as { reason: string }).reason).toBe('cancelled');
  });

  // ---------------------------------------------------------------------
  // CASE 4 — Reasoning-effort evaluator path emits the bracketing events.
  // ---------------------------------------------------------------------
  it('emits the reasoning-effort bracketing status events into the stream buffer', async () => {
    const evaluator = async (
      _input: EvaluateReasoningEffortInput,
    ): Promise<ReasoningEffortEvaluation> => ({
      shouldEvaluate: true,
      effortLabel: 'high',
      effortForMessage: 'high',
      evaluatedBy: 'gpt-4.1-nano',
      evaluatorModel: 'gpt-4.1-nano',
    });
    fixture = buildFixture({ evaluateReasoningEffort: evaluator });
    await seedSessionAndUserTurn(fixture);
    const ctx = await fixture.runtime.prepareAssistantRun({
      userId,
      sessionId,
      assistantMessageId,
    });
    // Drive the runtime's evaluator wrapper directly — emits 1 status
    // event on the streamId because `shouldEvaluate=true` + no failure.
    const evaluation = await fixture.runtime.evaluateReasoningEffort({
      userId,
      workspaceId: ctx.sessionWorkspaceId,
      selectedProviderId: 'openai',
      selectedModel: 'gpt-5',
      streamId: assistantMessageId,
      conversation: ctx.conversation,
    });
    expect(evaluation.shouldEvaluate).toBe(true);
    expect(evaluation.effortLabel).toBe('high');

    const statusEvents = fixture.streamBuffer
      .snapshot(assistantMessageId)
      .filter((event) => event.eventType === 'status');
    expect(statusEvents).toHaveLength(1);
    expect(statusEvents[0]?.data).toMatchObject({
      state: 'reasoning_effort_selected',
      effort: 'high',
      by: 'gpt-4.1-nano',
    });

    // streamSequencer.peek returns the last-allocated sequence (=1).
    const peeked = await fixture.runtime.peekStreamSequence(assistantMessageId);
    expect(peeked).toBe(1);
  });

  // ---------------------------------------------------------------------
  // CASE 5 — Checkpoint create + list + restore round-trip.
  // ---------------------------------------------------------------------
  it('performs a checkpoint create + list + restore round-trip across stores', async () => {
    await seedSessionAndUserTurn(fixture);

    // Seed extra messages so the checkpoint anchor at sequence 2 has
    // material to restore past (sequences 3..4 will be removed on restore).
    await fixture.messageStore.insertMany([
      {
        id: 'msg-user-2',
        sessionId,
        role: 'user',
        content: 'Follow-up question',
        sequence: 3,
        createdAt: new Date('2026-05-14T10:00:10Z'),
      },
      {
        id: 'msg-assistant-2',
        sessionId,
        role: 'assistant',
        content: 'follow-up answer',
        sequence: 4,
        createdAt: new Date('2026-05-14T10:00:11Z'),
      },
    ]);

    // Create a checkpoint anchored at the placeholder assistant row
    // (sequence 2). Persists into the InMemoryCheckpointStore.
    const created = await fixture.runtime.createCheckpoint({
      sessionId,
      title: 'After first reply',
      anchorMessageId: assistantMessageId,
    });
    expect(created.anchorMessageId).toBe(assistantMessageId);
    expect(created.anchorSequence).toBe(2);
    expect(created.messageCount).toBe(2);

    // Listing returns the freshly created checkpoint.
    const listed = await fixture.runtime.listCheckpoints({ sessionId });
    expect(listed).toHaveLength(1);
    expect(listed[0]?.id).toBe(created.id);

    // The raw checkpoint entry exposes the encoded key shape.
    const rawKey = `${sessionId}#${created.id}`;
    const rawEntry = fixture.checkpointStore.raw(rawKey);
    expect(rawEntry).toBeDefined();
    expect(rawEntry?.version).toBe(1);

    // Restore the checkpoint — drops sequences 3..4.
    const restored = await fixture.runtime.restoreCheckpoint({
      sessionId,
      checkpointId: created.id,
    });
    expect(restored.restoredToSequence).toBe(2);
    expect(restored.removedMessages).toBe(2);

    const remaining = await fixture.messageStore.listForSession(sessionId);
    expect(remaining.map((row) => row.id)).toEqual(['msg-user-1', assistantMessageId]);
    expect(remaining.map((row) => row.sequence)).toEqual([1, 2]);
  });
});
