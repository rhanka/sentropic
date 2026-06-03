import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// BR-42f Lot 4 — GCP SSE provider-attribution test (sibling to
// gemini-attribution-characterization.test.ts). Proves that the SHARED Gemini
// SSE→event runtime loop, once parameterized by the active provider (M4),
// attributes a GCP stream/response to `gcp` — NOT `gemini`:
//   - generate response id  -> `gcp_…`   (index.ts:962, activeProviderId)
//   - stream response_id     -> `gcp_…`   (index.ts:1247)
//   - stream tool-call id    -> `gcp_call_…` (index.ts:1335)
//   - no-content status      -> provider_id: 'gcp' (index.ts:1359)
//
// AND the bearer-never-logged proof (D-ADC1): the ADC bearer is minted
// PRE-DISPATCH (toMeshAuthInput) and DOES reach the runtime as the dispatch
// `credential` (so the call can actually be authenticated), but it must NEVER
// appear in any yielded StreamEvent NOR in any console log line.
//
// Setup mirrors gemini-attribution-characterization.test.ts: NO live calls. The
// GCP ADC minter is stubbed (`__setGcpAdcMinter`), env carries
// GOOGLE_CLOUD_PROJECT/GOOGLE_CLOUD_LOCATION so the mint path runs, and the `gcp`
// provider runtime's generate/streamGenerate are spied to yield raw
// Gemini-shaped payloads (the GCP wire shape == Gemini wire shape).
// (Provider id renamed vertex→gcp — user decision 2026-06-02, Vertex AI brand
// retired; the endpoint host stays aiplatform.googleapis.com.)
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

// GCP auth is ADC-minted (source:'none' from the string resolver); the mint
// happens in toMeshAuthInput. This mock keeps the resolver honest for gcp.
vi.mock('../../src/services/provider-credentials', () => ({
  resolveProviderCredential: vi.fn().mockResolvedValue({
    providerId: 'gcp',
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
    GOOGLE_CLOUD_PROJECT: 'test-gcp-project',
    GOOGLE_CLOUD_LOCATION: 'us-central1',
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
  __setGcpAdcMinter,
  __resetGcpTokenCache,
} from '../../src/services/providers/gcp-provider';

// A unique sentinel value that could ONLY originate from the stubbed ADC mint.
const SECRET_BEARER = 'gcp-secret-bearer-DO-NOT-LOG-3f9c2e';
const GCP_MODEL = 'google/gemini-3.5-flash@gcp';

async function collectStreamEvents(
  generator: AsyncGenerator<StreamEvent>,
): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  for await (const event of generator) {
    events.push(event);
  }
  return events;
}

describe('GCP provider-attribution characterization (BR-42f Lot 4)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetGcpTokenCache();
    __setGcpAdcMinter(async () => ({
      token: SECRET_BEARER,
      expiresAtMs: Number.MAX_SAFE_INTEGER,
    }));
  });

  afterEach(() => {
    __resetGcpTokenCache();
  });

  it('attributes the generate response id with the `gcp_` prefix (not `gemini_`)', async () => {
    const { providerRegistry } = await import('../../src/services/provider-registry');
    const provider = providerRegistry.requireProvider('gcp');
    // Raw Gemini-shaped generateContent payload (single text part).
    vi.spyOn(provider, 'generate').mockResolvedValue({
      candidates: [{ content: { parts: [{ text: 'Hello world' }] } }],
    } as unknown as Awaited<ReturnType<typeof provider.generate>>);

    const { callLLM } = await import('../../src/services/llm-runtime');
    const completion = await callLLM({
      messages: [{ role: 'user', content: 'Hi' }],
      providerId: 'gcp',
      model: GCP_MODEL,
    });

    expect(completion.id.startsWith('gcp_')).toBe(true);
    expect(completion.id.startsWith('gemini_')).toBe(false);
    expect(completion.choices[0]?.message.content).toBe('Hello world');
  });

  it('attributes the stream response_id with the `gcp_` prefix (not `gemini_`)', async () => {
    const { providerRegistry } = await import('../../src/services/provider-registry');
    const provider = providerRegistry.requireProvider('gcp');
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
        providerId: 'gcp',
        model: GCP_MODEL,
      }),
    );

    const responseCreated = events.find(
      (e) =>
        e.type === 'status' &&
        (e.data as { state?: string }).state === 'response_created',
    );
    expect(responseCreated).toBeDefined();
    const responseId = (responseCreated!.data as { response_id: string }).response_id;
    expect(responseId.startsWith('gcp_')).toBe(true);
    expect(responseId.startsWith('gemini_')).toBe(false);
  });

  it('attributes stream tool-call ids with the `gcp_call_` prefix (not `gemini_call_`)', async () => {
    const { providerRegistry } = await import('../../src/services/provider-registry');
    const provider = providerRegistry.requireProvider('gcp');
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
        providerId: 'gcp',
        model: GCP_MODEL,
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
    expect(toolCallId).toBe('gcp_call_1');
    expect(toolCallId.startsWith('gcp_call_')).toBe(true);
    expect(toolCallId.startsWith('gemini_call_')).toBe(false);
  });

  it('attributes the no-content status event with provider_id `gcp`', async () => {
    const { providerRegistry } = await import('../../src/services/provider-registry');
    const provider = providerRegistry.requireProvider('gcp');
    vi.spyOn(provider, 'streamGenerate').mockResolvedValue(
      (async function* () {
        yield { candidates: [{ content: { parts: [] }, finishReason: 'STOP' }] };
      })(),
    );

    const { callLLMStream } = await import('../../src/services/llm-runtime');
    const events = await collectStreamEvents(
      callLLMStream({
        messages: [{ role: 'user', content: 'Use a tool' }],
        providerId: 'gcp',
        model: GCP_MODEL,
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
    expect((noContentStatus!.data as { provider_id: string }).provider_id).toBe('gcp');
  });

  it('mints the ADC bearer pre-dispatch and forwards it to the runtime, but NEVER logs/leaks it', async () => {
    const { providerRegistry } = await import('../../src/services/provider-registry');
    const provider = providerRegistry.requireProvider('gcp');

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
          providerId: 'gcp',
          model: GCP_MODEL,
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
