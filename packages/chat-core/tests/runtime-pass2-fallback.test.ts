/**
 * BR14b Lot 22a-2 — `ChatRuntime.runPass2Fallback` unit tests.
 *
 * Exercises the pass2 fallback slice migrated from
 * `ChatService.runAssistantGeneration` (chat-service.ts lines 3707-3813
 * post-Lot 22a-1). The runtime method:
 *   1. Guards on `contentParts.join('').trim()` non-empty (short-circuit
 *      with `skipped:true`).
 *   2. Builds the pass2 system + pass2 messages from `conversation` +
 *      `buildToolDigest(executedTools)`.
 *   3. Resets `contentParts`, `reasoningParts`, `lastErrorMessage`
 *      in-place.
 *   4. Optionally emits the `pass2_prompt` trace via the Option A
 *      callback (skipped silently when undefined).
 *   5. Streams via `deps.mesh.invokeStream`, forwarding every non-`done`
 *      event to `deps.streamBuffer.append` and advancing `streamSeq`.
 *   6. Catches stream errors, emits a final `error` event, rethrows.
 *   7. Throws `'Second pass produced no content'` if `contentParts` is
 *      still empty after streaming.
 *
 * Tests cover: guard short-circuit, message build (digest + conversation
 * spread + FR directives), buffer reset, trace callback emission +
 * shape, stream content/reasoning accumulation, error event capture,
 * streamSeq cursor advancement, thrown-error rethrow path, empty-content
 * post-stream throw, mesh dispatch forwarding.
 */
import { describe, expect, it, vi } from 'vitest';

import { ChatRuntime } from '../src/runtime.js';
import type {
  ChatRuntimeDeps,
  RunPass2FallbackInput,
} from '../src/runtime.js';
import type { ChatState } from '../src/types.js';
import type { MeshStreamEvent } from '../src/mesh-port.js';
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
    mesh,
    streamBuffer,
  };
};

const buildInput = (
  overrides: Partial<RunPass2FallbackInput> = {},
): RunPass2FallbackInput => ({
  streamId: 'msg-1',
  assistantMessageId: 'msg-1',
  sessionId: 'sess-1',
  userId: 'user-1',
  workspaceId: 'ws-1',
  providerId: 'openai',
  model: 'gpt-5.5',
  credential: undefined,
  signal: undefined,
  reasoningEffort: 'medium',
  conversation: [
    { role: 'system', content: 'system base' },
    { role: 'user', content: 'Hello world?' },
  ],
  executedTools: [{ name: 'web_search', result: { hits: ['a', 'b'] } }],
  systemPrompt: 'You are a helpful assistant.',
  contentParts: [],
  reasoningParts: [],
  streamSeq: 5,
  traceEnabled: true,
  writeChatGenerationTrace: undefined,
  ...overrides,
});

describe('ChatRuntime.runPass2Fallback (Lot 22a-2)', () => {
  it('short-circuits with skipped=true when contentParts already non-empty', async () => {
    const { runtime, mesh, streamBuffer } = buildFixture();
    const input = buildInput({
      contentParts: ['already produced final content'],
      streamSeq: 12,
    });
    const result = await runtime.runPass2Fallback(input);
    expect(result.skipped).toBe(true);
    expect(result.streamSeq).toBe(12);
    expect(result.lastErrorMessage).toBe(null);
    // No mesh dispatch, no stream events appended.
    expect(mesh.streamCalls).toHaveLength(0);
    expect(streamBuffer.snapshot('msg-1')).toHaveLength(0);
    // Buffer NOT reset by the guard branch (caller's content preserved).
    expect(input.contentParts).toEqual(['already produced final content']);
  });

  it('treats whitespace-only contentParts as empty (mirrors `!join.trim()`)', async () => {
    const { runtime, mesh } = buildFixture();
    mesh.enqueueStream([
      { type: 'content_delta', data: { delta: 'final answer' } },
      { type: 'done', data: {} },
    ]);
    const input = buildInput({
      contentParts: ['  ', '\n\t '],
    });
    const result = await runtime.runPass2Fallback(input);
    expect(result.skipped).toBe(false);
    expect(input.contentParts).toEqual(['final answer']);
  });

  it('resets contentParts + reasoningParts in-place before streaming', async () => {
    const { runtime, mesh } = buildFixture();
    mesh.enqueueStream([
      { type: 'content_delta', data: { delta: 'fresh content' } },
      { type: 'reasoning_delta', data: { delta: 'fresh reasoning' } },
      { type: 'done', data: {} },
    ]);
    // contentParts has only whitespace so guard does NOT short-circuit,
    // but reasoningParts carries stale data that must be wiped.
    const input = buildInput({
      contentParts: ['  '],
      reasoningParts: ['stale reasoning'],
    });
    const result = await runtime.runPass2Fallback(input);
    expect(result.skipped).toBe(false);
    expect(input.contentParts).toEqual(['fresh content']);
    expect(input.reasoningParts).toEqual(['fresh reasoning']);
  });

  it('builds the pass2 message bundle with digest, FR directives, and synthesized user message', async () => {
    const { runtime, mesh } = buildFixture();
    mesh.enqueueStream([
      { type: 'content_delta', data: { delta: 'ok' } },
      { type: 'done', data: {} },
    ]);
    const input = buildInput({
      systemPrompt: 'BASE_SYS_PROMPT',
      conversation: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'Earliest question' },
        { role: 'assistant', content: '...' },
        { role: 'user', content: 'Final pending question?' },
      ],
      executedTools: [
        { name: 'web_search', result: { hits: ['x'] } },
        { name: 'fetch_page', result: 'plain string' },
      ],
    });
    await runtime.runPass2Fallback(input);
    expect(mesh.streamCalls).toHaveLength(1);
    const call = mesh.streamCalls[0];
    expect(call.tools).toBeUndefined();
    expect(call.toolChoice).toBe('none');
    expect(call.reasoningSummary).toBe('detailed');
    expect(call.reasoningEffort).toBe('medium');
    expect(call.providerId).toBe('openai');
    expect(call.model).toBe('gpt-5.5');
    const messages = call.messages as Array<{
      role: string;
      content: string;
    }>;
    // system + 4 conversation + synthesized user = 6 messages
    expect(messages).toHaveLength(6);
    expect(messages[0].role).toBe('system');
    expect(messages[0].content).toContain('BASE_SYS_PROMPT');
    expect(messages[0].content).toContain(
      "Tu dois maintenant produire une réponse finale",
    );
    expect(messages[0].content).toContain("Tu n'as pas le droit d'appeler d'outil");
    expect(messages[0].content).toContain('en français');
    // Verbatim conversation spread between system and synthesized user.
    expect(messages[1]).toEqual({ role: 'system', content: 'sys' });
    expect(messages[2]).toEqual({
      role: 'user',
      content: 'Earliest question',
    });
    expect(messages[3]).toEqual({ role: 'assistant', content: '...' });
    expect(messages[4]).toEqual({
      role: 'user',
      content: 'Final pending question?',
    });
    // Synthesized user message uses the LAST user from conversation +
    // tool digest of executedTools.
    const synthesized = messages[5];
    expect(synthesized.role).toBe('user');
    expect(synthesized.content).toContain(
      'Demande utilisateur: Final pending question?',
    );
    expect(synthesized.content).toContain('- web_search:');
    expect(synthesized.content).toContain('- fetch_page:');
    expect(synthesized.content).toContain('Rédige maintenant la réponse finale.');
  });

  it('falls back to `(aucun outil exécuté)` digest when executedTools is empty', async () => {
    const { runtime, mesh } = buildFixture();
    mesh.enqueueStream([
      { type: 'content_delta', data: { delta: 'ok' } },
      { type: 'done', data: {} },
    ]);
    const input = buildInput({
      executedTools: [],
      conversation: [{ role: 'user', content: 'nothing happened' }],
    });
    await runtime.runPass2Fallback(input);
    const messages = mesh.streamCalls[0].messages as Array<{
      content: string;
    }>;
    const synthesized = messages[messages.length - 1];
    expect(synthesized.content).toContain('(aucun outil exécuté)');
  });

  it('emits the pass2_prompt trace via writeChatGenerationTrace callback when wired', async () => {
    const traceSpy = vi.fn(async () => undefined);
    const { runtime, mesh } = buildFixture();
    mesh.enqueueStream([
      { type: 'content_delta', data: { delta: 'ok' } },
      { type: 'done', data: {} },
    ]);
    const input = buildInput({
      writeChatGenerationTrace: traceSpy,
      traceEnabled: true,
    });
    await runtime.runPass2Fallback(input);
    expect(traceSpy).toHaveBeenCalledTimes(1);
    const traceArg = traceSpy.mock.calls[0][0];
    expect(traceArg.enabled).toBe(true);
    expect(traceArg.phase).toBe('pass2');
    expect(traceArg.iteration).toBe(1);
    expect(traceArg.toolChoice).toBe('none');
    expect(traceArg.tools).toBe(null);
    expect(traceArg.toolCalls).toBe(null);
    expect(traceArg.meta).toEqual({
      kind: 'pass2_prompt',
      callSite:
        'ChatService.runAssistantGeneration/pass2/beforeOpenAI',
      openaiApi: 'responses',
    });
    expect(traceArg.openaiMessages).toBeInstanceOf(Array);
  });

  it('silently skips trace when writeChatGenerationTrace callback is undefined', async () => {
    const { runtime, mesh } = buildFixture();
    mesh.enqueueStream([
      { type: 'content_delta', data: { delta: 'ok' } },
      { type: 'done', data: {} },
    ]);
    const input = buildInput({ writeChatGenerationTrace: undefined });
    const result = await runtime.runPass2Fallback(input);
    expect(result.skipped).toBe(false);
    // No error thrown — trace is opt-in.
  });

  it('forwards stream events to streamBuffer and advances streamSeq via streamSequencer', async () => {
    const { runtime, mesh, streamBuffer } = buildFixture();
    mesh.enqueueStream([
      { type: 'content_delta', data: { delta: 'Hello ' } },
      { type: 'reasoning_delta', data: { delta: 'thinking...' } },
      { type: 'content_delta', data: { delta: 'world.' } },
      { type: 'done', data: {} },
    ]);
    const input = buildInput({ streamSeq: 10 });
    const result = await runtime.runPass2Fallback(input);
    expect(result.skipped).toBe(false);
    expect(input.contentParts).toEqual(['Hello ', 'world.']);
    expect(input.reasoningParts).toEqual(['thinking...']);
    // 3 non-done events appended (done is dropped).
    const events = streamBuffer.snapshot('msg-1');
    expect(events).toHaveLength(3);
    expect(events.map((e) => e.eventType)).toEqual([
      'content_delta',
      'reasoning_delta',
      'content_delta',
    ]);
    // sequencer starts at 0, allocates 1,2,3 — result.streamSeq is last+1.
    expect(result.streamSeq).toBe(4);
  });

  it('captures error event message in lastErrorMessage and keeps streaming', async () => {
    const { runtime, mesh, streamBuffer } = buildFixture();
    mesh.enqueueStream([
      { type: 'error', data: { message: 'rate limited' } },
      { type: 'content_delta', data: { delta: 'recovered' } },
      { type: 'done', data: {} },
    ]);
    const input = buildInput();
    const result = await runtime.runPass2Fallback(input);
    expect(result.skipped).toBe(false);
    expect(result.lastErrorMessage).toBe('rate limited');
    expect(input.contentParts).toEqual(['recovered']);
    // error + content_delta appended.
    const events = streamBuffer.snapshot('msg-1');
    expect(events.map((e) => e.eventType)).toEqual([
      'error',
      'content_delta',
    ]);
  });

  it('uses fallback `Unknown error` when error event message is non-string', async () => {
    const { runtime, mesh } = buildFixture();
    mesh.enqueueStream([
      { type: 'error', data: { message: 42 } },
      { type: 'content_delta', data: { delta: 'still works' } },
      { type: 'done', data: {} },
    ]);
    const input = buildInput();
    const result = await runtime.runPass2Fallback(input);
    expect(result.lastErrorMessage).toBe('Unknown error');
  });

  it('rethrows on stream exception after emitting a final error event', async () => {
    const { runtime, deps, streamBuffer } = buildFixture();
    // Sabotaged mesh: iterator throws mid-stream.
    const sabotagedMesh = {
      ...deps.mesh,
      invokeStream: () => {
        return (async function* (): AsyncGenerator<MeshStreamEvent> {
          yield { type: 'content_delta', data: { delta: 'partial' } };
          throw new Error('network reset');
        })();
      },
    };
    (deps as { mesh: typeof sabotagedMesh }).mesh = sabotagedMesh;
    const input = buildInput();
    await expect(runtime.runPass2Fallback(input)).rejects.toThrow(
      'network reset',
    );
    // Last appended event is the synthesized error event.
    const events = streamBuffer.snapshot('msg-1');
    const last = events[events.length - 1];
    expect(last.eventType).toBe('error');
    expect((last.data as { message: string }).message).toBe('network reset');
  });

  it('throws `Second pass produced no content` and emits error event when stream ends with empty content', async () => {
    const { runtime, mesh, streamBuffer } = buildFixture();
    mesh.enqueueStream([
      { type: 'reasoning_delta', data: { delta: 'just thinking, no output' } },
      { type: 'done', data: {} },
    ]);
    const input = buildInput();
    await expect(runtime.runPass2Fallback(input)).rejects.toThrow(
      'Second pass produced no content',
    );
    // reasoning_delta appended + error event appended (post-stream).
    const events = streamBuffer.snapshot('msg-1');
    const last = events[events.length - 1];
    expect(last.eventType).toBe('error');
    expect((last.data as { message: string }).message).toBe(
      'Second pass produced no content',
    );
  });
});
