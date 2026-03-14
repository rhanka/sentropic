import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock all external dependencies to isolate stream normalization logic
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
    providerId: 'openai',
    credential: 'test-key',
    source: 'environment',
  }),
}));

vi.mock('../../src/config/env', () => ({
  env: {
    OPENAI_API_KEY: 'test-openai-key',
    MISTRAL_API_KEY: '',
    ANTHROPIC_API_KEY: '',
    GEMINI_API_KEY: '',
    COHERE_API_KEY: '',
  },
}));

vi.mock('@mistralai/mistralai', () => {
  return {
    Mistral: vi.fn().mockImplementation(() => ({
      chat: {
        complete: vi.fn(),
        stream: vi.fn(),
      },
    })),
  };
});

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

async function collectStreamEvents(generator: AsyncGenerator<StreamEvent>): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  for await (const event of generator) {
    events.push(event);
  }
  return events;
}

describe('OpenAI stream event normalization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('gpt-4.1-nano (standard model)', () => {
    it('should normalize content delta from OpenAI Responses API format', async () => {
      const { providerRegistry } = await import('../../src/services/provider-registry');
      const provider = providerRegistry.requireProvider('openai');
      vi.spyOn(provider, 'streamGenerate').mockResolvedValue(
        (async function* () {
          yield { type: 'response.created', response: { id: 'resp_test_123' } };
          yield { type: 'response.output_text.delta', delta: 'Hello' };
          yield { type: 'response.output_text.delta', delta: ' world' };
          yield { type: 'response.completed' };
        })(),
      );

      const { callOpenAIResponseStream } = await import('../../src/services/llm-runtime');

      const events = await collectStreamEvents(
        callOpenAIResponseStream({
          messages: [{ role: 'user', content: 'Hi' }],
          providerId: 'openai',
          model: 'gpt-4.1-nano',
        }),
      );

      const contentDeltas = events.filter((e) => e.type === 'content_delta');
      expect(contentDeltas).toHaveLength(2);
      expect((contentDeltas[0].data as { delta: string }).delta).toBe('Hello');
      expect((contentDeltas[1].data as { delta: string }).delta).toBe(' world');

      const doneEvents = events.filter((e) => e.type === 'done');
      expect(doneEvents).toHaveLength(1);
    });

    it('should normalize tool calls from OpenAI Responses API format', async () => {
      const { providerRegistry } = await import('../../src/services/provider-registry');
      const provider = providerRegistry.requireProvider('openai');
      vi.spyOn(provider, 'streamGenerate').mockResolvedValue(
        (async function* () {
          yield { type: 'response.created', response: { id: 'resp_test_456' } };
          yield {
            type: 'response.output_item.added',
            item: {
              type: 'function_call',
              id: 'fc_item_1',
              call_id: 'call_1',
              name: 'search',
              arguments: '',
            },
          };
          yield {
            type: 'response.function_call_arguments.delta',
            item_id: 'fc_item_1',
            delta: '{"q":',
          };
          yield {
            type: 'response.function_call_arguments.delta',
            item_id: 'fc_item_1',
            delta: '"test"}',
          };
          yield { type: 'response.completed' };
        })(),
      );

      const { callOpenAIResponseStream } = await import('../../src/services/llm-runtime');

      const events = await collectStreamEvents(
        callOpenAIResponseStream({
          messages: [{ role: 'user', content: 'Search something' }],
          providerId: 'openai',
          model: 'gpt-4.1-nano',
        }),
      );

      const toolStarts = events.filter((e) => e.type === 'tool_call_start');
      expect(toolStarts).toHaveLength(1);
      expect((toolStarts[0].data as { name: string }).name).toBe('search');
      expect((toolStarts[0].data as { tool_call_id: string }).tool_call_id).toBe('call_1');

      const toolDeltas = events.filter((e) => e.type === 'tool_call_delta');
      expect(toolDeltas).toHaveLength(2);
      expect((toolDeltas[0].data as { delta: string }).delta).toBe('{"q":');
      expect((toolDeltas[1].data as { delta: string }).delta).toBe('"test"}');
    });
  });

  describe('gpt-5.4 (reasoning model)', () => {
    it('should normalize reasoning chunks to reasoning_delta events', async () => {
      const { providerRegistry } = await import('../../src/services/provider-registry');
      const provider = providerRegistry.requireProvider('openai');
      vi.spyOn(provider, 'streamGenerate').mockResolvedValue(
        (async function* () {
          yield { type: 'response.created', response: { id: 'resp_test_789' } };
          yield { type: 'response.reasoning_text.delta', delta: 'Let me think...' };
          yield { type: 'response.reasoning_text.delta', delta: ' about this.' };
          yield { type: 'response.output_text.delta', delta: 'The answer is 42' };
          yield { type: 'response.completed' };
        })(),
      );

      const { callOpenAIResponseStream } = await import('../../src/services/llm-runtime');

      const events = await collectStreamEvents(
        callOpenAIResponseStream({
          messages: [{ role: 'user', content: 'What is the meaning of life?' }],
          providerId: 'openai',
          model: 'gpt-5.4',
        }),
      );

      const reasoningDeltas = events.filter((e) => e.type === 'reasoning_delta');
      expect(reasoningDeltas).toHaveLength(2);
      expect((reasoningDeltas[0].data as { delta: string }).delta).toBe('Let me think...');
      expect((reasoningDeltas[1].data as { delta: string }).delta).toBe(' about this.');

      const contentDeltas = events.filter((e) => e.type === 'content_delta');
      expect(contentDeltas).toHaveLength(1);
      expect((contentDeltas[0].data as { delta: string }).delta).toBe('The answer is 42');

      const doneEvents = events.filter((e) => e.type === 'done');
      expect(doneEvents).toHaveLength(1);
    });
  });

  it('should emit status started event at the beginning', async () => {
    const { providerRegistry } = await import('../../src/services/provider-registry');
    const provider = providerRegistry.requireProvider('openai');
    vi.spyOn(provider, 'streamGenerate').mockResolvedValue(
      (async function* () {
        yield { type: 'response.created', response: { id: 'resp_test_000' } };
        yield { type: 'response.completed' };
      })(),
    );

    const { callOpenAIResponseStream } = await import('../../src/services/llm-runtime');

    const events = await collectStreamEvents(
      callOpenAIResponseStream({
        messages: [{ role: 'user', content: 'Hi' }],
        providerId: 'openai',
        model: 'gpt-4.1-nano',
      }),
    );

    expect(events[0].type).toBe('status');
    expect((events[0].data as { state: string }).state).toBe('started');
  });
});
