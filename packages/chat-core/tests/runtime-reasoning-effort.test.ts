/**
 * BR14b Lot 18 — `ChatRuntime.evaluateReasoningEffort` unit tests.
 *
 * Exercises the reasoning-effort evaluator migrated from
 * `ChatService.runAssistantGeneration` (chat-service.ts lines 2806-2910
 * pre-Lot 18). The runtime method is a slim wrapper around the
 * `evaluateReasoningEffort` callback wired into `ChatRuntimeDeps`. The
 * callback owns the body (prompt build, mesh stream, token validation,
 * fallback semantics) because it depends on the chat prompt registry
 * which lives api-side. The unit tests therefore exercise the boundary
 * contract — fallback when no callback is wired, callback forwarding,
 * and the failure surface — plus emulate the callback shape via
 * `InMemoryMeshDispatch` to confirm the integration contract chat-service
 * relies on stays stable.
 */
import { describe, expect, it, vi } from 'vitest';

import { ChatRuntime } from '../src/runtime.js';
import type {
  ChatRuntimeDeps,
  EvaluateReasoningEffortInput,
  ReasoningEffortEvaluation,
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

/**
 * Reference callback body — re-implements the verbatim block from
 * `ChatService.evaluateReasoningEffortInternal` (api side) using only
 * `MeshDispatchPort.invokeStream` so chat-core can integration-test the
 * runtime wrapper end-to-end via `InMemoryMeshDispatch`. The shape and
 * semantics (provider-family decision, token validation, error/throw
 * fallback) MUST stay byte-identical to the api-side body so the unit
 * tests catch real-life regressions.
 */
const buildEvaluatorCallback = (
  mesh: InMemoryMeshDispatch,
  reasoningTier: (model: string) => 'none' | 'low' | 'medium' | 'high' | 'xhigh',
  evalTemplate = 'Effort? Last user message: {{last_user_message}} Excerpt: {{context_excerpt}}',
) => {
  return async (
    input: EvaluateReasoningEffortInput,
  ): Promise<ReasoningEffortEvaluation> => {
    const shouldEvaluate = reasoningTier(input.selectedModel) !== 'none';
    const evaluatorModel =
      input.selectedProviderId === 'gemini'
        ? 'gemini-3.1-flash-lite-preview'
        : 'gpt-4.1-nano';
    if (!shouldEvaluate) {
      return {
        shouldEvaluate: false,
        effortLabel: 'medium',
        evaluatedBy: 'non-gpt-5',
        evaluatorModel: null,
      };
    }
    try {
      let out = '';
      for await (const ev of mesh.invokeStream({
        providerId:
          input.selectedProviderId === 'gemini' ? 'gemini' : 'openai',
        model: evaluatorModel,
        userId: input.userId,
        workspaceId: input.workspaceId ?? undefined,
        messages: [
          {
            role: 'user',
            content: evalTemplate.replace(
              '{{last_user_message}}',
              input.conversation.findLast?.((m) => m.role === 'user')?.content ?? '',
            ),
          },
        ],
        maxOutputTokens: 64,
        signal: input.signal,
      })) {
        if (ev.type === 'content_delta') {
          const d = (ev.data ?? {}) as Record<string, unknown>;
          const delta = typeof d.delta === 'string' ? d.delta : '';
          if (delta) out += delta;
        } else if (ev.type === 'error') {
          const d = (ev.data ?? {}) as Record<string, unknown>;
          const msg =
            typeof d.message === 'string'
              ? d.message
              : 'Reasoning effort evaluation failed';
          throw new Error(msg);
        }
      }
      const token = out.trim().split(/\s+/g)[0]?.toLowerCase() || '';
      if (
        token === 'none' ||
        token === 'low' ||
        token === 'medium' ||
        token === 'high' ||
        token === 'xhigh'
      ) {
        return {
          shouldEvaluate: true,
          effortLabel: token,
          effortForMessage: token,
          evaluatedBy: evaluatorModel,
          evaluatorModel,
        };
      }
      throw new Error(
        `Invalid effort token from ${evaluatorModel}: "${out.trim().slice(0, 200)}"`,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e ?? 'unknown');
      return {
        shouldEvaluate: true,
        effortLabel: 'medium',
        evaluatedBy: 'fallback',
        evaluatorModel,
        failure: { message: msg.slice(0, 500) },
      };
    }
  };
};

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
  return { runtime: new ChatRuntime(deps), mesh, deps, streamBuffer, streamSequencer };
};

const buildInput = (
  overrides: Partial<EvaluateReasoningEffortInput> = {},
): EvaluateReasoningEffortInput => ({
  userId: 'user-1',
  workspaceId: 'ws-1',
  selectedProviderId: 'openai',
  selectedModel: 'gpt-5',
  streamId: 'stream-test-1',
  conversation: [
    { role: 'user', content: 'How do I plan a roadmap?' },
  ],
  ...overrides,
});

describe('ChatRuntime.evaluateReasoningEffort (Lot 18)', () => {
  it('returns the fallback evaluation when no callback is wired', async () => {
    const { runtime } = buildFixture({ evaluateReasoningEffort: undefined });
    const result = await runtime.evaluateReasoningEffort(buildInput());
    expect(result).toEqual({
      shouldEvaluate: false,
      effortLabel: 'medium',
      evaluatedBy: 'fallback',
      evaluatorModel: null,
    });
  });

  it('skips evaluation and reports non-gpt-5 for non-reasoning models', async () => {
    const fixture = buildFixture();
    const callback = buildEvaluatorCallback(fixture.mesh, (model) =>
      model === 'gpt-5' ? 'high' : 'none',
    );
    fixture.deps.evaluateReasoningEffort?.toString;
    const { runtime } = buildFixture({ evaluateReasoningEffort: callback });
    const result = await runtime.evaluateReasoningEffort(
      buildInput({ selectedModel: 'gpt-4.1-mini' }),
    );
    expect(result).toEqual({
      shouldEvaluate: false,
      effortLabel: 'medium',
      evaluatedBy: 'non-gpt-5',
      evaluatorModel: null,
    });
  });

  it('returns the validated label and evaluator model on the gpt-5 happy path (high)', async () => {
    const mesh = new InMemoryMeshDispatch();
    mesh.enqueueStream([
      { type: 'content_delta', data: { delta: 'high' } },
      { type: 'done', data: {} },
    ]);
    const callback = buildEvaluatorCallback(mesh, () => 'high');
    const { runtime } = buildFixture({
      evaluateReasoningEffort: callback,
    });
    const result = await runtime.evaluateReasoningEffort(
      buildInput({ selectedProviderId: 'openai', selectedModel: 'gpt-5' }),
    );
    expect(result.shouldEvaluate).toBe(true);
    expect(result.effortLabel).toBe('high');
    expect(result.effortForMessage).toBe('high');
    expect(result.evaluatedBy).toBe('gpt-4.1-nano');
    expect(result.evaluatorModel).toBe('gpt-4.1-nano');
    expect(result.failure).toBeUndefined();
    // The evaluator must have routed through the openai provider.
    expect(mesh.streamCalls).toHaveLength(1);
    expect(mesh.streamCalls[0]?.providerId).toBe('openai');
    expect(mesh.streamCalls[0]?.model).toBe('gpt-4.1-nano');
  });

  it('routes to the gemini evaluator on gemini happy path (low)', async () => {
    const mesh = new InMemoryMeshDispatch();
    mesh.enqueueStream([
      { type: 'content_delta', data: { delta: 'low' } },
      { type: 'done', data: {} },
    ]);
    const callback = buildEvaluatorCallback(mesh, () => 'high');
    const { runtime } = buildFixture({
      evaluateReasoningEffort: callback,
    });
    const result = await runtime.evaluateReasoningEffort(
      buildInput({
        selectedProviderId: 'gemini',
        selectedModel: 'gemini-3-pro',
      }),
    );
    expect(result.shouldEvaluate).toBe(true);
    expect(result.effortLabel).toBe('low');
    expect(result.effortForMessage).toBe('low');
    expect(result.evaluatedBy).toBe('gemini-3.1-flash-lite-preview');
    expect(result.evaluatorModel).toBe('gemini-3.1-flash-lite-preview');
    expect(mesh.streamCalls).toHaveLength(1);
    expect(mesh.streamCalls[0]?.providerId).toBe('gemini');
    expect(mesh.streamCalls[0]?.model).toBe('gemini-3.1-flash-lite-preview');
  });

  it('falls back to medium and surfaces a failure when the evaluator token is invalid', async () => {
    const mesh = new InMemoryMeshDispatch();
    mesh.enqueueStream([
      { type: 'content_delta', data: { delta: 'totally not a valid token' } },
      { type: 'done', data: {} },
    ]);
    const callback = buildEvaluatorCallback(mesh, () => 'high');
    const { runtime } = buildFixture({
      evaluateReasoningEffort: callback,
    });
    const result = await runtime.evaluateReasoningEffort(buildInput());
    expect(result.shouldEvaluate).toBe(true);
    expect(result.effortLabel).toBe('medium');
    expect(result.effortForMessage).toBeUndefined();
    expect(result.evaluatedBy).toBe('fallback');
    expect(result.evaluatorModel).toBe('gpt-4.1-nano');
    expect(result.failure?.message).toContain('Invalid effort token');
  });

  it('falls back to medium and surfaces a failure when the mesh stream emits an error event', async () => {
    const mesh = new InMemoryMeshDispatch();
    mesh.enqueueStream([
      {
        type: 'error',
        data: { message: 'evaluator unavailable', request_id: 'req-abc' },
      },
    ]);
    const callback = buildEvaluatorCallback(mesh, () => 'high');
    const { runtime } = buildFixture({
      evaluateReasoningEffort: callback,
    });
    const result = await runtime.evaluateReasoningEffort(buildInput());
    expect(result.shouldEvaluate).toBe(true);
    expect(result.effortLabel).toBe('medium');
    expect(result.evaluatedBy).toBe('fallback');
    expect(result.failure?.message).toContain('evaluator unavailable');
  });

  it('forwards the EvaluateReasoningEffortInput to the callback verbatim', async () => {
    const spy = vi.fn(
      async (): Promise<ReasoningEffortEvaluation> => ({
        shouldEvaluate: true,
        effortLabel: 'xhigh',
        effortForMessage: 'xhigh',
        evaluatedBy: 'spy-model',
        evaluatorModel: 'spy-model',
      }),
    );
    const { runtime } = buildFixture({ evaluateReasoningEffort: spy });
    const input = buildInput({
      userId: 'user-42',
      workspaceId: null,
      selectedProviderId: 'gemini',
      selectedModel: 'gemini-3-pro',
      conversation: [
        { role: 'user', content: 'Question A' },
        { role: 'assistant', content: 'Answer A' },
        { role: 'user', content: 'Question B' },
      ],
    });
    const result = await runtime.evaluateReasoningEffort(input);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[0]).toEqual(input);
    expect(result.effortLabel).toBe('xhigh');
  });
});

describe('ChatRuntime.evaluateReasoningEffort bracketing events (Lot 20)', () => {
  it('emits exactly 1 status event (reasoning_effort_selected) on the happy path', async () => {
    const mesh = new InMemoryMeshDispatch();
    mesh.enqueueStream([
      { type: 'content_delta', data: { delta: 'high' } },
      { type: 'done', data: {} },
    ]);
    const callback = buildEvaluatorCallback(mesh, () => 'high');
    const { runtime, streamBuffer, streamSequencer } = buildFixture({
      evaluateReasoningEffort: callback,
    });
    const result = await runtime.evaluateReasoningEffort(
      buildInput({ streamId: 'happy-1' }),
    );
    expect(result.shouldEvaluate).toBe(true);
    expect(result.failure).toBeUndefined();

    const events = streamBuffer.snapshot('happy-1');
    expect(events).toHaveLength(1);
    expect(events[0]?.eventType).toBe('status');
    expect(events[0]?.sequence).toBe(1);
    expect(events[0]?.data).toEqual({
      state: 'reasoning_effort_selected',
      effort: 'high',
      by: 'gpt-4.1-nano',
    });
    // Sequencer cursor consumed exactly 1 slot.
    expect(await streamSequencer.peek('happy-1')).toBe(1);
  });

  it('emits 2 status events in order (eval_failed then selected) on the failure path', async () => {
    const mesh = new InMemoryMeshDispatch();
    mesh.enqueueStream([
      { type: 'content_delta', data: { delta: 'totally-invalid-token' } },
      { type: 'done', data: {} },
    ]);
    const callback = buildEvaluatorCallback(mesh, () => 'high');
    const { runtime, streamBuffer, streamSequencer } = buildFixture({
      evaluateReasoningEffort: callback,
    });
    const result = await runtime.evaluateReasoningEffort(
      buildInput({ streamId: 'fail-1' }),
    );
    expect(result.shouldEvaluate).toBe(true);
    expect(result.failure).toBeDefined();
    expect(result.effortLabel).toBe('medium');

    const events = streamBuffer.snapshot('fail-1');
    expect(events).toHaveLength(2);
    // Order matters: eval_failed at seq 1, then selected at seq 2.
    expect(events[0]?.sequence).toBe(1);
    expect(events[0]?.eventType).toBe('status');
    expect((events[0]?.data as { state: string }).state).toBe(
      'reasoning_effort_eval_failed',
    );
    expect((events[0]?.data as { message: string }).message).toContain(
      'Invalid effort token',
    );
    expect(events[1]?.sequence).toBe(2);
    expect(events[1]?.eventType).toBe('status');
    expect(events[1]?.data).toEqual({
      state: 'reasoning_effort_selected',
      effort: 'medium',
      by: 'fallback',
    });
    expect(await streamSequencer.peek('fail-1')).toBe(2);
  });

  it('emits NO stream events when shouldEvaluate=false (callback unwired)', async () => {
    const { runtime, streamBuffer, streamSequencer } = buildFixture({
      evaluateReasoningEffort: undefined,
    });
    await runtime.evaluateReasoningEffort(buildInput({ streamId: 'noop-1' }));

    expect(streamBuffer.snapshot('noop-1')).toHaveLength(0);
    expect(await streamSequencer.peek('noop-1')).toBe(0);
  });

  it('emits NO stream events when shouldEvaluate=false (non-reasoning model branch)', async () => {
    const fixture = buildFixture();
    const callback = buildEvaluatorCallback(fixture.mesh, (model) =>
      model === 'gpt-5' ? 'high' : 'none',
    );
    const { runtime, streamBuffer, streamSequencer } = buildFixture({
      evaluateReasoningEffort: callback,
    });
    await runtime.evaluateReasoningEffort(
      buildInput({ streamId: 'non-gpt-5', selectedModel: 'gpt-4.1-mini' }),
    );

    expect(streamBuffer.snapshot('non-gpt-5')).toHaveLength(0);
    expect(await streamSequencer.peek('non-gpt-5')).toBe(0);
  });

  it('preserves monotonic sequence allocation across multiple calls on the same stream', async () => {
    const mesh1 = new InMemoryMeshDispatch();
    mesh1.enqueueStream([
      { type: 'content_delta', data: { delta: 'low' } },
      { type: 'done', data: {} },
    ]);
    mesh1.enqueueStream([
      { type: 'content_delta', data: { delta: 'high' } },
      { type: 'done', data: {} },
    ]);
    const callback = buildEvaluatorCallback(mesh1, () => 'high');
    const { runtime, streamBuffer, streamSequencer } = buildFixture({
      evaluateReasoningEffort: callback,
    });
    await runtime.evaluateReasoningEffort(buildInput({ streamId: 'mono-1' }));
    await runtime.evaluateReasoningEffort(buildInput({ streamId: 'mono-1' }));

    const events = streamBuffer.snapshot('mono-1');
    expect(events).toHaveLength(2);
    expect(events[0]?.sequence).toBe(1);
    expect(events[1]?.sequence).toBe(2);
    expect(await streamSequencer.peek('mono-1')).toBe(2);
  });

  it('isolates sequence allocation across different streamIds', async () => {
    const meshA = new InMemoryMeshDispatch();
    meshA.enqueueStream([
      { type: 'content_delta', data: { delta: 'high' } },
      { type: 'done', data: {} },
    ]);
    meshA.enqueueStream([
      { type: 'content_delta', data: { delta: 'low' } },
      { type: 'done', data: {} },
    ]);
    const callback = buildEvaluatorCallback(meshA, () => 'high');
    const { runtime, streamBuffer, streamSequencer } = buildFixture({
      evaluateReasoningEffort: callback,
    });
    await runtime.evaluateReasoningEffort(buildInput({ streamId: 'iso-a' }));
    await runtime.evaluateReasoningEffort(buildInput({ streamId: 'iso-b' }));

    expect(streamBuffer.snapshot('iso-a')).toHaveLength(1);
    expect(streamBuffer.snapshot('iso-a')[0]?.sequence).toBe(1);
    expect(streamBuffer.snapshot('iso-b')).toHaveLength(1);
    expect(streamBuffer.snapshot('iso-b')[0]?.sequence).toBe(1);
    expect(await streamSequencer.peek('iso-a')).toBe(1);
    expect(await streamSequencer.peek('iso-b')).toBe(1);
  });

  it('appends events with the streamId set as messageId on the stored row', async () => {
    const mesh = new InMemoryMeshDispatch();
    mesh.enqueueStream([
      { type: 'content_delta', data: { delta: 'high' } },
      { type: 'done', data: {} },
    ]);
    const callback = buildEvaluatorCallback(mesh, () => 'high');
    const { runtime, streamBuffer } = buildFixture({
      evaluateReasoningEffort: callback,
    });
    await runtime.evaluateReasoningEffort(buildInput({ streamId: 'msg-row-1' }));

    const events = streamBuffer.snapshot('msg-row-1');
    expect(events).toHaveLength(1);
    expect(events[0]?.messageId).toBe('msg-row-1');
    expect(events[0]?.streamId).toBe('msg-row-1');
  });
});
