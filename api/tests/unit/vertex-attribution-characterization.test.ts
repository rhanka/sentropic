import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// BR-42f Lot 4 — Vertex SSE provider-attribution test (sibling to
// gemini-attribution-characterization.test.ts). Proves that the SHARED Gemini
// SSE→event runtime loop, once parameterized by the active provider (M4),
// attributes a Vertex stream/response to `vertex` — NOT `gemini`:
//   - generate response id  -> `vertex_…`   (index.ts:962, activeProviderId)
//   - stream response_id     -> `vertex_…`   (index.ts:1247)
//   - stream tool-call id    -> `vertex_call_…` (index.ts:1335)
//   - no-content status      -> provider_id: 'vertex' (index.ts:1359)
//
// AND the bearer-never-logged proof (D-ADC1): the ADC bearer is minted
// PRE-DISPATCH (toMeshAuthInput) and DOES reach the runtime as the dispatch
// `credential` (so the call can actually be authenticated), but it must NEVER
// appear in any yielded StreamEvent NOR in any console log line.
//
// Setup mirrors gemini-attribution-characterization.test.ts: NO live calls. The
// Vertex ADC minter is stubbed (`__setVertexAdcMinter`), env carries
// VERTEX_PROJECT_ID/VERTEX_LOCATION so the mint path runs, and the `vertex`
// provider runtime's generate/streamGenerate are spied to yield raw
// Gemini-shaped payloads (the Vertex wire shape == Gemini wire shape).
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

// Vertex auth is ADC-minted (source:'none' from the string resolver); the mint
// happens in toMeshAuthInput. This mock keeps the resolver honest for vertex.
vi.mock('../../src/services/provider-credentials', () => ({
  resolveProviderCredential: vi.fn().mockResolvedValue({
    providerId: 'vertex',
    credential: null,
    source: 'none',
  }),
}));

vi.mock('../../src/config/env', () => ({
  env: {
    ANTHROPIC_API_KEY: 'test-anthropic-key',
    OPENAI_API_KEY: 'test-openai-key',
    GEMINI_API_KEY: 'test-gemini-key',
    MISTRAL_API_KEY: 'test-mistral-key',
    COHERE_API_KEY: 'test-cohere-key',
    VERTEX_PROJECT_ID: 'test-vertex-project',
    VERTEX_LOCATION: 'us-central1',
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
import {
  __setVertexAdcMinter,
  __resetVertexTokenCache,
} from '../../src/services/providers/vertex-provider';

// A unique sentinel value that could ONLY originate from the stubbed ADC mint.
const SECRET_BEARER = 'vertex-secret-bearer-DO-NOT-LOG-3f9c2e';
const VERTEX_MODEL = 'google/gemini-3.5-flash@vertex';

async function collectStreamEvents(
  generator: AsyncGenerator<StreamEvent>,
): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  for await (const event of generator) {
    events.push(event);
  }
  return events;
}

describe('Vertex provider-attribution characterization (BR-42f Lot 4)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetVertexTokenCache();
    __setVertexAdcMinter(async () => ({
      token: SECRET_BEARER,
      expiresAtMs: Number.MAX_SAFE_INTEGER,
    }));
  });

  afterEach(() => {
    __resetVertexTokenCache();
  });

  it('attributes the generate response id with the `vertex_` prefix (not `gemini_`)', async () => {
    const { providerRegistry } = await import('../../src/services/provider-registry');
    const provider = providerRegistry.requireProvider('vertex');
    // Raw Gemini-shaped generateContent payload (single text part).
    vi.spyOn(provider, 'generate').mockResolvedValue({
      candidates: [{ content: { parts: [{ text: 'Hello world' }] } }],
    } as unknown as Awaited<ReturnType<typeof provider.generate>>);

    const { callLLM } = await import('../../src/services/llm-runtime');
    const completion = await callLLM({
      messages: [{ role: 'user', content: 'Hi' }],
      providerId: 'vertex',
      model: VERTEX_MODEL,
    });

    expect(completion.id.startsWith('vertex_')).toBe(true);
    expect(completion.id.startsWith('gemini_')).toBe(false);
    expect(completion.choices[0]?.message.content).toBe('Hello world');
  });

  it('attributes the stream response_id with the `vertex_` prefix (not `gemini_`)', async () => {
    const { providerRegistry } = await import('../../src/services/provider-registry');
    const provider = providerRegistry.requireProvider('vertex');
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
        providerId: 'vertex',
        model: VERTEX_MODEL,
      }),
    );

    const responseCreated = events.find(
      (e) =>
        e.type === 'status' &&
        (e.data as { state?: string }).state === 'response_created',
    );
    expect(responseCreated).toBeDefined();
    const responseId = (responseCreated!.data as { response_id: string }).response_id;
    expect(responseId.startsWith('vertex_')).toBe(true);
    expect(responseId.startsWith('gemini_')).toBe(false);
  });

  it('attributes stream tool-call ids with the `vertex_call_` prefix (not `gemini_call_`)', async () => {
    const { providerRegistry } = await import('../../src/services/provider-registry');
    const provider = providerRegistry.requireProvider('vertex');
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
        providerId: 'vertex',
        model: VERTEX_MODEL,
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
    expect(toolCallId).toBe('vertex_call_1');
    expect(toolCallId.startsWith('vertex_call_')).toBe(true);
    expect(toolCallId.startsWith('gemini_call_')).toBe(false);
  });

  it('attributes the no-content status event with provider_id `vertex`', async () => {
    const { providerRegistry } = await import('../../src/services/provider-registry');
    const provider = providerRegistry.requireProvider('vertex');
    vi.spyOn(provider, 'streamGenerate').mockResolvedValue(
      (async function* () {
        yield { candidates: [{ content: { parts: [] }, finishReason: 'STOP' }] };
      })(),
    );

    const { callLLMStream } = await import('../../src/services/llm-runtime');
    const events = await collectStreamEvents(
      callLLMStream({
        messages: [{ role: 'user', content: 'Use a tool' }],
        providerId: 'vertex',
        model: VERTEX_MODEL,
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
    expect((noContentStatus!.data as { provider_id: string }).provider_id).toBe('vertex');
  });

  it('mints the ADC bearer pre-dispatch and forwards it to the runtime, but NEVER logs/leaks it', async () => {
    const { providerRegistry } = await import('../../src/services/provider-registry');
    const provider = providerRegistry.requireProvider('vertex');

    // Capture the runtime request handed to the spied streamGenerate so we can
    // prove the minted bearer ACTUALLY reached the runtime (the call can be
    // authenticated) — while still proving it never leaks into events/logs.
    let capturedRequest: unknown;
    vi.spyOn(provider, 'streamGenerate').mockImplementation(async (request) => {
      capturedRequest = request;
      return (async function* () {
        yield { candidates: [{ content: { parts: [{ text: 'Authenticated' }] } }] };
        yield { candidates: [{ content: { parts: [] }, finishReason: 'STOP' }] };
      })();
    });

    const consoleSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => {}),
    );

    try {
      const { callLLMStream } = await import('../../src/services/llm-runtime');
      const events = await collectStreamEvents(
        callLLMStream({
          messages: [{ role: 'user', content: 'Hi' }],
          providerId: 'vertex',
          model: VERTEX_MODEL,
        }),
      );

      // The minted bearer reached the runtime as the dispatch credential (proof
      // the pre-dispatch mint flows to the wire call).
      expect((capturedRequest as { credential?: string }).credential).toBe(SECRET_BEARER);

      // ...but it must NEVER appear in any yielded event.
      const serializedEvents = JSON.stringify(events);
      expect(serializedEvents).not.toContain(SECRET_BEARER);

      // ...and it must NEVER appear in any console output.
      for (const spy of consoleSpies) {
        for (const call of spy.mock.calls) {
          expect(JSON.stringify(call)).not.toContain(SECRET_BEARER);
        }
      }
    } finally {
      for (const spy of consoleSpies) spy.mockRestore();
    }
  });
});
