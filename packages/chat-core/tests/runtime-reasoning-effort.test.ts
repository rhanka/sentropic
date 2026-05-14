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
  return { runtime: new ChatRuntime(deps), mesh, deps };
};

const buildInput = (
  overrides: Partial<EvaluateReasoningEffortInput> = {},
): EvaluateReasoningEffortInput => ({
  userId: 'user-1',
  workspaceId: 'ws-1',
  selectedProviderId: 'openai',
  selectedModel: 'gpt-5',
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
