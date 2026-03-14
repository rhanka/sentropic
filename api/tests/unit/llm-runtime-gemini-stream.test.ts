import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock all external dependencies to isolate stream normalization logic
vi.mock('../../src/services/settings', () => ({
  settingsService: {
    getAISettings: vi.fn().mockResolvedValue({
      defaultProviderId: 'gemini',
      defaultModel: 'gemini-3.1-flash-lite-preview',
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
    credential: 'test-key',
    source: 'environment',
  }),
}));

vi.mock('../../src/config/env', () => ({
  env: {
    GEMINI_API_KEY: 'test-gemini-key',
    OPENAI_API_KEY: 'test-openai-key',
    ANTHROPIC_API_KEY: '',
    MISTRAL_API_KEY: '',
    COHERE_API_KEY: '',
  },
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: { create: vi.fn(), stream: vi.fn() },
  })),
}));

vi.mock('@mistralai/mistralai', () => ({
  Mistral: vi.fn().mockImplementation(() => ({
    chat: { complete: vi.fn(), stream: vi.fn() },
  })),
}));

vi.mock('cohere-ai', () => ({
  CohereClient: vi.fn().mockImplementation(() => ({
    v2: { chat: vi.fn(), chatStream: vi.fn() },
  })),
}));

import type { StreamEvent } from '../../src/services/llm-runtime';

async function collectStreamEvents(generator: AsyncGenerator<StreamEvent>): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  for await (const event of generator) {
    events.push(event);
  }
  return events;
}

describe('Gemini stream event normalization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('gemini-3.1-flash-lite-preview (standard model)', () => {
    it('should normalize content delta from Gemini format', async () => {
      const { providerRegistry } = await import('../../src/services/provider-registry');
      const provider = providerRegistry.requireProvider('gemini');
      vi.spyOn(provider, 'streamGenerate').mockResolvedValue(
        (async function* () {
          yield {
            candidates: [
              {
                content: { parts: [{ text: 'Hello' }] },
              },
            ],
          };
          yield {
            candidates: [
              {
                content: { parts: [{ text: ' world' }] },
              },
            ],
          };
          yield {
            candidates: [
              {
                content: { parts: [] },
                finishReason: 'STOP',
              },
            ],
          };
        })(),
      );

      const { callOpenAIResponseStream } = await import('../../src/services/llm-runtime');

      const events = await collectStreamEvents(
        callOpenAIResponseStream({
          messages: [{ role: 'user', content: 'Hi' }],
          providerId: 'gemini',
          model: 'gemini-3.1-flash-lite-preview',
        }),
      );

      const contentDeltas = events.filter((e) => e.type === 'content_delta');
      expect(contentDeltas).toHaveLength(2);
      expect((contentDeltas[0].data as { delta: string }).delta).toBe('Hello');
      expect((contentDeltas[1].data as { delta: string }).delta).toBe(' world');

      const doneEvents = events.filter((e) => e.type === 'done');
      expect(doneEvents).toHaveLength(1);
    });

    it('should normalize tool calls from Gemini format', async () => {
      const { providerRegistry } = await import('../../src/services/provider-registry');
      const provider = providerRegistry.requireProvider('gemini');
      vi.spyOn(provider, 'streamGenerate').mockResolvedValue(
        (async function* () {
          yield {
            candidates: [
              {
                content: {
                  parts: [
                    {
                      functionCall: {
                        name: 'search',
                        args: { query: 'test' },
                      },
                    },
                  ],
                },
              },
            ],
          };
          yield {
            candidates: [
              {
                content: { parts: [] },
                finishReason: 'STOP',
              },
            ],
          };
        })(),
      );

      const { callOpenAIResponseStream } = await import('../../src/services/llm-runtime');

      const events = await collectStreamEvents(
        callOpenAIResponseStream({
          messages: [{ role: 'user', content: 'Search for test' }],
          providerId: 'gemini',
          model: 'gemini-3.1-flash-lite-preview',
        }),
      );

      const toolStarts = events.filter((e) => e.type === 'tool_call_start');
      expect(toolStarts).toHaveLength(1);
      expect((toolStarts[0].data as { name: string }).name).toBe('search');
      expect((toolStarts[0].data as { tool_call_id: string }).tool_call_id).toBe('gemini_call_1');
      expect((toolStarts[0].data as { args: string }).args).toBe('{"query":"test"}');
    });

    it('should emit status started event at the beginning', async () => {
      const { providerRegistry } = await import('../../src/services/provider-registry');
      const provider = providerRegistry.requireProvider('gemini');
      vi.spyOn(provider, 'streamGenerate').mockResolvedValue(
        (async function* () {
          yield {
            candidates: [
              {
                content: { parts: [] },
                finishReason: 'STOP',
              },
            ],
          };
        })(),
      );

      const { callOpenAIResponseStream } = await import('../../src/services/llm-runtime');

      const events = await collectStreamEvents(
        callOpenAIResponseStream({
          messages: [{ role: 'user', content: 'Hi' }],
          providerId: 'gemini',
          model: 'gemini-3.1-flash-lite-preview',
        }),
      );

      expect(events[0].type).toBe('status');
      expect((events[0].data as { state: string }).state).toBe('started');
    });
  });

  describe('gemini-3.1-pro-preview-customtools (reasoning model)', () => {
    // NOTE: Reasoning/thinking is NOT implemented in the Gemini stream block.
    // The stream handler only processes `text` and `functionCall` parts from
    // candidates[].content.parts[]. There is no detection of thinking/reasoning
    // content for Gemini, unlike Claude or Cohere providers.
    // A reasoning test is therefore skipped.

    it('should emit status started event at the beginning', async () => {
      const { providerRegistry } = await import('../../src/services/provider-registry');
      const provider = providerRegistry.requireProvider('gemini');
      vi.spyOn(provider, 'streamGenerate').mockResolvedValue(
        (async function* () {
          yield {
            candidates: [
              {
                content: { parts: [{ text: 'Answer' }] },
                finishReason: 'STOP',
              },
            ],
          };
        })(),
      );

      const { callOpenAIResponseStream } = await import('../../src/services/llm-runtime');

      const events = await collectStreamEvents(
        callOpenAIResponseStream({
          messages: [{ role: 'user', content: 'Think about this' }],
          providerId: 'gemini',
          model: 'gemini-3.1-pro-preview-customtools',
        }),
      );

      expect(events[0].type).toBe('status');
      expect((events[0].data as { state: string }).state).toBe('started');

      const contentDeltas = events.filter((e) => e.type === 'content_delta');
      expect(contentDeltas).toHaveLength(1);
      expect((contentDeltas[0].data as { delta: string }).delta).toBe('Answer');

      const doneEvents = events.filter((e) => e.type === 'done');
      expect(doneEvents).toHaveLength(1);
    });
  });
});
