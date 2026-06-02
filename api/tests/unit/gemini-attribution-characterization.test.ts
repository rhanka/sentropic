import { describe, expect, it, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// BR-42f Lot 1 — CHARACTERIZATION oracle for the Gemini SSE provider-attribution
// literals that Lot 3/M4 will parameterize by provider in the SHARED runtime loop.
//
// This file LOCKS the CURRENT (pre-vertex) attribution so that, after Lot 3
// parameterizes the prefixes/provider_id by the active provider, Gemini output
// stays byte-identical (`gemini_…` / `gemini_call_…` / provider_id `'gemini'`)
// while Vertex later receives its own `vertex_…` / `vertex_call_…` / `'vertex'`.
//
// Verified anchors in api/src/services/llm-runtime/index.ts (current HEAD):
//   - :921  generate branch  -> response id  `gemini_${createId()}`
//   - :1200 stream branch     -> response_id  `gemini_${createId()}`
//   - :1281 stream branch     -> tool-call id `gemini_call_${toolCallIndex}`
//   - :1305 stream branch     -> status       provider_id: 'gemini'
//             (gated by `!emittedContent && filteredTools.length > 0`)
//
// Setup/mocks mirror tests/unit/llm-runtime-stream.test.ts: no live calls — the
// gemini provider runtime's generate/streamGenerate are spied to yield raw
// Gemini-shaped payloads, and the normalized runtime output is asserted.
// ---------------------------------------------------------------------------

vi.mock('../../src/services/settings', () => ({
  settingsService: {
    getAISettings: vi.fn().mockResolvedValue({
      defaultProviderId: 'openai',
      defaultModel: 'gpt-4.1-nano',
      concurrency: 1,
      publishingConcurrency: 1,
      processingInterval: 1000,
    }),
    get: vi.fn().mockResolvedValue(null),
  },
}));

vi.mock('../../src/services/provider-credentials', () => ({
  resolveProviderCredential: vi.fn().mockResolvedValue({
    providerId: 'gemini',
    credential: 'test-gemini-key',
    source: 'environment',
  }),
}));

vi.mock('../../src/config/env', () => ({
  env: {
    ANTHROPIC_API_KEY: 'test-anthropic-key',
    OPENAI_API_KEY: 'test-openai-key',
    GEMINI_API_KEY: 'test-gemini-key',
    MISTRAL_API_KEY: 'test-mistral-key',
    COHERE_API_KEY: 'test-cohere-key',
  },
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: { create: vi.fn(), stream: vi.fn() },
  })),
}));

vi.mock('cohere-ai', () => ({
  CohereClient: vi.fn().mockImplementation(() => ({
    v2: { chat: vi.fn(), chatStream: vi.fn() },
  })),
}));

import type { StreamEvent } from '../../src/services/llm-runtime';

const GEMINI_MODEL = 'gemini-3.5-flash';

async function collectStreamEvents(
  generator: AsyncGenerator<StreamEvent>,
): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  for await (const event of generator) {
    events.push(event);
  }
  return events;
}

describe('Gemini provider-attribution characterization (BR-42f Lot 1 oracle)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('attributes the generate response id with the `gemini_` prefix (index.ts:921)', async () => {
    const { providerRegistry } = await import('../../src/services/provider-registry');
    const provider = providerRegistry.requireProvider('gemini');
    // Raw Gemini generateContent payload (single text part) — see extractGeminiText.
    vi.spyOn(provider, 'generate').mockResolvedValue({
      candidates: [{ content: { parts: [{ text: 'Hello world' }] } }],
    } as unknown as Awaited<ReturnType<typeof provider.generate>>);

    const { callLLM } = await import('../../src/services/llm-runtime');
    const completion = await callLLM({
      messages: [{ role: 'user', content: 'Hi' }],
      providerId: 'gemini',
      model: GEMINI_MODEL,
    });

    expect(completion.id.startsWith('gemini_')).toBe(true);
    expect(completion.id.startsWith('vertex_')).toBe(false);
    expect(completion.choices[0]?.message.content).toBe('Hello world');
  });

  it('attributes the stream response_id with the `gemini_` prefix (index.ts:1200)', async () => {
    const { providerRegistry } = await import('../../src/services/provider-registry');
    const provider = providerRegistry.requireProvider('gemini');
    vi.spyOn(provider, 'streamGenerate').mockResolvedValue(
      (async function* () {
        yield { candidates: [{ content: { parts: [{ text: 'Hello' }] } }] };
        yield { candidates: [{ content: { parts: [] }, finishReason: 'STOP' }] };
      })(),
    );

    const { callLLMStream } = await import('../../src/services/llm-runtime');
    const events = await collectStreamEvents(
      callLLMStream({
        messages: [{ role: 'user', content: 'Hi' }],
        providerId: 'gemini',
        model: GEMINI_MODEL,
      }),
    );

    const responseCreated = events.find(
      (e) =>
        e.type === 'status' &&
        (e.data as { state?: string }).state === 'response_created',
    );
    expect(responseCreated).toBeDefined();
    const responseId = (responseCreated!.data as { response_id: string }).response_id;
    expect(responseId.startsWith('gemini_')).toBe(true);
    expect(responseId.startsWith('vertex_')).toBe(false);
  });

  it('attributes stream tool-call ids with the `gemini_call_` prefix (index.ts:1281)', async () => {
    const { providerRegistry } = await import('../../src/services/provider-registry');
    const provider = providerRegistry.requireProvider('gemini');
    vi.spyOn(provider, 'streamGenerate').mockResolvedValue(
      (async function* () {
        yield {
          candidates: [
            {
              content: {
                parts: [{ functionCall: { name: 'search', args: { query: 'test' } } }],
              },
            },
          ],
        };
        yield { candidates: [{ content: { parts: [] }, finishReason: 'STOP' }] };
      })(),
    );

    const { callLLMStream } = await import('../../src/services/llm-runtime');
    const events = await collectStreamEvents(
      callLLMStream({
        messages: [{ role: 'user', content: 'Search please' }],
        providerId: 'gemini',
        model: GEMINI_MODEL,
        tools: [
          {
            type: 'function',
            function: { name: 'search', parameters: { type: 'object', properties: {} } },
          },
        ],
        toolChoice: 'auto',
      }),
    );

    const toolStart = events.find((e) => e.type === 'tool_call_start');
    expect(toolStart).toBeDefined();
    const toolCallId = (toolStart!.data as { tool_call_id: string }).tool_call_id;
    expect(toolCallId).toBe('gemini_call_1');
    expect(toolCallId.startsWith('gemini_call_')).toBe(true);
    expect(toolCallId.startsWith('vertex_call_')).toBe(false);
  });

  it('attributes the no-content status event with provider_id `gemini` (index.ts:1305)', async () => {
    const { providerRegistry } = await import('../../src/services/provider-registry');
    const provider = providerRegistry.requireProvider('gemini');
    // A tools request where Gemini emits NO content part => triggers the
    // `provider_completed_without_content` status carrying provider_id.
    vi.spyOn(provider, 'streamGenerate').mockResolvedValue(
      (async function* () {
        yield { candidates: [{ content: { parts: [] }, finishReason: 'STOP' }] };
      })(),
    );

    const { callLLMStream } = await import('../../src/services/llm-runtime');
    const events = await collectStreamEvents(
      callLLMStream({
        messages: [{ role: 'user', content: 'Use a tool' }],
        providerId: 'gemini',
        model: GEMINI_MODEL,
        tools: [
          {
            type: 'function',
            function: { name: 'search', parameters: { type: 'object', properties: {} } },
          },
        ],
        toolChoice: 'auto',
      }),
    );

    const noContentStatus = events.find(
      (e) =>
        e.type === 'status' &&
        (e.data as { state?: string }).state === 'provider_completed_without_content',
    );
    expect(noContentStatus).toBeDefined();
    expect((noContentStatus!.data as { provider_id: string }).provider_id).toBe('gemini');
  });
});
