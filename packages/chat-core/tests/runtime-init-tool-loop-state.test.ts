/**
 * BR14b Lot 22a-1 — `ChatRuntime.initToolLoopState` unit tests.
 *
 * Exercises the pre-loop init slice migrated from
 * `ChatService.runAssistantGeneration` (chat-service.ts lines 3084-3157
 * pre-Lot 22a-1). The runtime method bundles four steps:
 *   1. `resolveModelSelection` (Lot 12/17 callback)
 *   2. derive `useCodexTransport`
 *   3. mutate `loopState.useCodexTransport`
 *   4. `evaluateReasoningEffort` (Lot 18/20 callback) + streamSeq
 *      re-sync via `peekStreamSequence + 1`
 *
 * Tests cover: happy path with codex transport, transport-mode
 * shortcuts (non-openai, non-gpt-5.5, token mode, dep unwired),
 * loopState in-place mutation, providerId/model fallback (legacy
 * `options.model || assistantRow.model`), reasoning callback wiring +
 * failure surface, streamSeq cursor re-sync after 0/1/2 status events,
 * input forwarding to `evaluateReasoningEffort`.
 */
import { describe, expect, it, vi } from 'vitest';

import { ChatRuntime } from '../src/runtime.js';
import type {
  ChatRuntimeDeps,
  EvaluateReasoningEffortInput,
  InitToolLoopStateInput,
  ReasoningEffortEvaluation,
  AssistantRunLoopState,
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
      model_id: 'gpt-5.5',
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
    deps,
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
  currentMessages: [],
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
  overrides: Partial<InitToolLoopStateInput> = {},
): InitToolLoopStateInput => ({
  userId: 'user-1',
  providerId: undefined,
  model: undefined,
  assistantRowModel: 'gpt-5.5',
  assistantMessageId: 'msg-1',
  sessionWorkspaceId: 'ws-1',
  conversation: [{ role: 'user', content: 'Plan a roadmap.' }],
  signal: undefined,
  loopState: buildLoopState(),
  ...overrides,
});

describe('ChatRuntime.initToolLoopState (Lot 22a-1)', () => {
  it('derives useCodexTransport=true when openai + gpt-5.5 + codex mode resolved', async () => {
    const { runtime } = buildFixture({
      resolveOpenAITransportMode: async () => 'codex',
    });
    const input = buildInput();
    const result = await runtime.initToolLoopState(input);
    expect(result.selectedProviderId).toBe('openai');
    expect(result.selectedModel).toBe('gpt-5.5');
    expect(result.useCodexTransport).toBe(true);
    // Loop state mutated in place.
    expect(input.loopState.useCodexTransport).toBe(true);
  });

  it('derives useCodexTransport=false when openai + gpt-5.5 + token mode resolved', async () => {
    const { runtime } = buildFixture({
      resolveOpenAITransportMode: async () => 'token',
    });
    const input = buildInput();
    const result = await runtime.initToolLoopState(input);
    expect(result.useCodexTransport).toBe(false);
    expect(input.loopState.useCodexTransport).toBe(false);
  });

  it('short-circuits useCodexTransport=false when resolveOpenAITransportMode is undefined', async () => {
    const { runtime } = buildFixture({
      resolveOpenAITransportMode: undefined,
    });
    const input = buildInput();
    const result = await runtime.initToolLoopState(input);
    expect(result.useCodexTransport).toBe(false);
    expect(input.loopState.useCodexTransport).toBe(false);
  });

  it('skips the transport-mode lookup when provider is not openai', async () => {
    const transportSpy = vi.fn(async () => 'codex' as const);
    const { runtime } = buildFixture({
      resolveModelSelection: async () => ({
        provider_id: 'gemini',
        model_id: 'gpt-5.5',
      }),
      resolveOpenAITransportMode: transportSpy,
    });
    const input = buildInput();
    const result = await runtime.initToolLoopState(input);
    expect(result.useCodexTransport).toBe(false);
    expect(transportSpy).not.toHaveBeenCalled();
  });

  it('skips the transport-mode lookup when model is not gpt-5.5', async () => {
    const transportSpy = vi.fn(async () => 'codex' as const);
    const { runtime } = buildFixture({
      resolveModelSelection: async () => ({
        provider_id: 'openai',
        model_id: 'gpt-4.1',
      }),
      resolveOpenAITransportMode: transportSpy,
    });
    const input = buildInput();
    const result = await runtime.initToolLoopState(input);
    expect(result.useCodexTransport).toBe(false);
    expect(transportSpy).not.toHaveBeenCalled();
  });

  it('forwards providerId + model verbatim to resolveModelSelection', async () => {
    const resolveSpy = vi.fn(async () => ({
      provider_id: 'anthropic',
      model_id: 'claude-3.5',
    }));
    const { runtime } = buildFixture({
      resolveModelSelection: resolveSpy,
    });
    const input = buildInput({
      providerId: 'anthropic',
      model: 'claude-3.5',
    });
    await runtime.initToolLoopState(input);
    expect(resolveSpy).toHaveBeenCalledTimes(1);
    expect(resolveSpy).toHaveBeenCalledWith({
      userId: 'user-1',
      providerId: 'anthropic',
      model: 'claude-3.5',
    });
  });

  it('falls back to assistantRowModel when options.model is empty (mirrors `model || assistantRow.model`)', async () => {
    const resolveSpy = vi.fn(async () => ({
      provider_id: 'openai',
      model_id: 'gpt-5.5',
    }));
    const { runtime } = buildFixture({
      resolveModelSelection: resolveSpy,
    });
    const input = buildInput({
      model: '',
      assistantRowModel: 'gpt-5.5-fallback',
    });
    await runtime.initToolLoopState(input);
    expect(resolveSpy).toHaveBeenCalledWith({
      userId: 'user-1',
      providerId: undefined,
      model: 'gpt-5.5-fallback',
    });
  });

  it('forwards conversation + workspaceId + signal + streamId to evaluateReasoningEffort', async () => {
    const reasoningSpy = vi.fn(
      async (_input: EvaluateReasoningEffortInput): Promise<ReasoningEffortEvaluation> => ({
        shouldEvaluate: false,
        effortLabel: 'medium',
        evaluatedBy: 'fallback',
        evaluatorModel: null,
      }),
    );
    const { runtime } = buildFixture({
      evaluateReasoningEffort: reasoningSpy,
    });
    const controller = new AbortController();
    const input = buildInput({
      sessionWorkspaceId: 'ws-42',
      conversation: [
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'second' },
      ],
      signal: controller.signal,
      assistantMessageId: 'msg-abc',
    });
    await runtime.initToolLoopState(input);
    expect(reasoningSpy).toHaveBeenCalledTimes(1);
    const call = reasoningSpy.mock.calls[0]?.[0];
    expect(call?.userId).toBe('user-1');
    expect(call?.workspaceId).toBe('ws-42');
    expect(call?.selectedProviderId).toBe('openai');
    expect(call?.selectedModel).toBe('gpt-5.5');
    expect(call?.conversation).toEqual([
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'second' },
    ]);
    expect(call?.signal).toBe(controller.signal);
    expect(call?.streamId).toBe('msg-abc');
  });

  it('returns the reasoning evaluation verbatim including effortForMessage alias', async () => {
    const evaluation: ReasoningEffortEvaluation = {
      shouldEvaluate: true,
      effortLabel: 'high',
      effortForMessage: 'high',
      evaluatedBy: 'gpt-4.1-nano',
      evaluatorModel: 'gpt-4.1-nano',
    };
    const { runtime } = buildFixture({
      evaluateReasoningEffort: async () => evaluation,
    });
    const result = await runtime.initToolLoopState(buildInput());
    expect(result.reasoning).toEqual(evaluation);
    expect(result.reasoningEffortForThisMessage).toBe('high');
  });

  it('returns reasoningEffortForThisMessage=undefined when evaluator does not surface it', async () => {
    const { runtime } = buildFixture({
      evaluateReasoningEffort: async () => ({
        shouldEvaluate: false,
        effortLabel: 'medium',
        evaluatedBy: 'fallback',
        evaluatorModel: null,
      }),
    });
    const result = await runtime.initToolLoopState(buildInput());
    expect(result.reasoning.effortForMessage).toBeUndefined();
    expect(result.reasoningEffortForThisMessage).toBeUndefined();
  });

  it('surfaces evaluation failure without throwing (caller emits console.error trace)', async () => {
    const { runtime } = buildFixture({
      evaluateReasoningEffort: async () => ({
        shouldEvaluate: true,
        effortLabel: 'medium',
        evaluatedBy: 'fallback',
        evaluatorModel: 'gpt-4.1-nano',
        failure: { message: 'mesh dispatch threw' },
      }),
    });
    const result = await runtime.initToolLoopState(buildInput());
    expect(result.reasoning.failure?.message).toBe('mesh dispatch threw');
    expect(result.reasoning.effortLabel).toBe('medium');
  });

  it('re-syncs streamSeq to peek + 1 after the runtime appends status events internally', async () => {
    // The runtime allocates 2 status events when shouldEvaluate=true with
    // a failure (legacy `reasoning_effort_eval_failed` +
    // `reasoning_effort_selected`). We seed the sequencer to start at 1
    // and confirm streamSeq is re-synced to peek + 1 after the call.
    const { runtime, streamBuffer } = buildFixture({
      evaluateReasoningEffort: async () => ({
        shouldEvaluate: true,
        effortLabel: 'medium',
        evaluatedBy: 'fallback',
        evaluatorModel: 'gpt-4.1-nano',
        failure: { message: 'boom' },
      }),
    });
    await streamBuffer.getNextSequence('msg-1');
    const result = await runtime.initToolLoopState(
      buildInput({ assistantMessageId: 'msg-1' }),
    );
    // 2 status events appended: failed at seq 1, selected at seq 2.
    // peek returns 2; streamSeq = peek + 1 = 3.
    expect(result.streamSeq).toBe(3);
  });

  it('re-syncs streamSeq with zero offset when no status events are appended (shouldEvaluate=false)', async () => {
    const { runtime } = buildFixture({
      evaluateReasoningEffort: async () => ({
        shouldEvaluate: false,
        effortLabel: 'medium',
        evaluatedBy: 'fallback',
        evaluatorModel: null,
      }),
    });
    const result = await runtime.initToolLoopState(buildInput());
    // No status events appended; peek returns 0; streamSeq = 0 + 1 = 1.
    expect(result.streamSeq).toBe(1);
  });

  it('mutates loopState.useCodexTransport in-place BEFORE evaluateReasoningEffort is invoked', async () => {
    // Behavior-preservation contract: the inline pre-Lot 22a-1 code
    // performed `loopState.useCodexTransport = useCodexTransport` at
    // line 3109 BEFORE calling `evaluateReasoningEffort` at line 3124.
    // Verify the mutation ordering survives the migration.
    const observedDuringReasoning: boolean[] = [];
    const input = buildInput();
    const { runtime } = buildFixture({
      resolveOpenAITransportMode: async () => 'codex',
      evaluateReasoningEffort: async () => {
        observedDuringReasoning.push(input.loopState.useCodexTransport);
        return {
          shouldEvaluate: false,
          effortLabel: 'medium',
          evaluatedBy: 'fallback',
          evaluatorModel: null,
        };
      },
    });
    await runtime.initToolLoopState(input);
    expect(observedDuringReasoning).toEqual([true]);
  });
});
